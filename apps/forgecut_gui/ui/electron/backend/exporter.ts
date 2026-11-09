import { rm, writeFile, open, rename } from "node:fs/promises";
import { join, dirname, extname, resolve as resolvePath } from "node:path";
import {
  EXPORT_PRESETS,
  type ExportPresetId,
} from "../shared/export-presets.js";
import { createExportStage } from "./export-staging.js";
import { resolveReviewWindow } from "../domain/review-range.js";
import type { ReviewRange } from "../shared/ipc-contract.js";
import type { Result } from "../shared/result.js";
import { runMediaProcess } from "./media-process.js";
import {
  MEDIA_SLICE_CPU_PERCENT,
  MEDIA_SLICE_THREADS,
} from "./process-budget.js";
import type { Project } from "./state.js";
import {
  compileExportPlan,
  type ExportPlan,
  type RenderPlan,
} from "./export-plan.js";
import { sequenceDurationUs } from "../domain/sequence.js";

import { prepareGraphicInputs } from "./prepare-graphic-inputs.js";

export { compileExportPlan } from "./export-plan.js";
export type { ExportPlan, RenderPlan, RenderInput } from "./export-plan.js";

export type RenderProgress = {
  percent: number;
  frame: number;
  fps: number;
  speed: string;
  eta_seconds: number | null;
};

type ExportOptions = {
  stagingId?: string;
  preset?: ExportPresetId;
  range?: ReviewRange;
  signal?: AbortSignal;
  beginCommit?: () => boolean;
  onProgress?: (progress: RenderProgress) => void;
};

type ExportOutcome = { outputPath: string; cleanupWarning?: string };

export async function exportProject(
  project: Project,
  outputPath: string,
  options: ExportOptions = {},
): Promise<Result<ExportOutcome>> {
  if (options.signal?.aborted)
    return {
      ok: false,
      error: { code: "CANCELLED", message: "Export cancelled." },
    };
  const window = resolveReviewWindow(project, options.range);
  if (!window.ok) return window;
  const preset = options.preset ?? "mp4";
  if (
    extname(outputPath).toLowerCase() !== `.${EXPORT_PRESETS[preset].extension}`
  )
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: `Choose a .${EXPORT_PRESETS[preset].extension} destination for this export preset.`,
      },
    };
  let directory: string | undefined;
  let result: Result<ExportOutcome>;
  try {
    const destination = resolvePath(outputPath);
    directory = await createExportStage(destination, options.stagingId);
    const prepared = await prepareGraphicInputs(
      project,
      directory,
      options.signal,
    );
    if (!prepared.ok) result = prepared;
    else {
      const plan = compileExportPlan(
        prepared.value,
        window.value,
        preset,
        directory,
      );
      result = await renderPrepared(
        plan,
        {
          directory,
          destination,
          totalSeconds:
            window.value?.durationSeconds ??
            totalTimelineDurationUs(project) / 1_000_000,
        },
        options,
      );
    }
  } catch (error) {
    result = {
      ok: false,
      error: {
        code: "IO_ERROR",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
  if (directory) {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      const warning = `Staging cleanup failed at ${directory}: ${error instanceof Error ? error.message : String(error)}`;
      if (result.ok)
        result = {
          ok: true,
          value: { ...result.value, cleanupWarning: warning },
        };
      else
        result = {
          ok: false,
          error: {
            ...result.error,
            message: `${result.error.message} ${warning}`,
          },
        };
    }
  }
  return result;
}

async function renderPrepared(
  plan: ExportPlan,
  target: { directory: string; destination: string; totalSeconds: number },
  options: ExportOptions,
): Promise<Result<ExportOutcome>> {
  for (const file of [...plan.spans, plan.mux].flatMap(
    (step) => step.textFiles,
  ))
    await writeFile(join(target.directory, file.name), file.content);
  for (const span of plan.spans) {
    const rendered = await executeRenderPlan(span, target.directory, options, {
      offsetSeconds: span.offsetSeconds,
      totalSeconds: target.totalSeconds,
    });
    if (!rendered.ok) return rendered;
  }
  const rendered = await executeRenderPlan(plan.mux, target.directory, options);
  if (!rendered.ok) return rendered;
  const file = await open(plan.mux.outputPath, "r");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
  if (options.signal?.aborted)
    return {
      ok: false,
      error: { code: "CANCELLED", message: "Export cancelled." },
    };
  if (options.beginCommit && !options.beginCommit())
    return {
      ok: false,
      error: {
        code: "CANCELLED",
        message: "Export cancelled before publication.",
      },
    };
  await rename(plan.mux.outputPath, target.destination);
  if (process.platform === "linux") {
    const parent = await open(dirname(target.destination), "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  }
  return { ok: true, value: { outputPath: target.destination } };
}

export function buildFfmpegArgs(plan: RenderPlan): string[] {
  return [
    "-y",
    "-hide_banner",
    "-threads",
    MEDIA_SLICE_THREADS,
    "-filter_complex_threads",
    MEDIA_SLICE_THREADS,
    ...plan.inputs.flatMap((input) => [
      "-threads",
      MEDIA_SLICE_THREADS,
      ...(input.format ? ["-f", input.format] : []),
      ...(input.range
        ? [
            "-ss",
            String(input.range.startUs / 1_000_000),
            "-t",
            String(input.range.durationUs / 1_000_000),
          ]
        : []),
      "-i",
      resolvePath(input.path),
    ]),
    "-filter_complex",
    plan.filterGraph,
    ...plan.outputArgs,
    plan.outputPath,
  ];
}

export function parseProgress(
  line: string,
  totalSeconds: number,
  offsetSeconds = 0,
): RenderProgress | null {
  if (!line.includes("time=")) return null;

  const frame = parseInteger(extractValue(line, "frame=")) ?? 0;
  const fps = parseNumber(extractValue(line, "fps=")) ?? 0;
  const speed = extractValue(line, "speed=") ?? "";
  const timeSeconds =
    offsetSeconds + (parseTimeString(extractValue(line, "time=") ?? "") ?? 0);
  const percent =
    totalSeconds > 0 ? Math.min((timeSeconds / totalSeconds) * 100, 100) : 0;
  const speedFactor =
    parseNumber(speed.endsWith("x") ? speed.slice(0, -1) : speed) ?? 0;
  const eta_seconds =
    speedFactor > 0 && totalSeconds > timeSeconds
      ? (totalSeconds - timeSeconds) / speedFactor
      : null;

  return {
    percent,
    frame,
    fps,
    speed,
    eta_seconds,
  };
}

export function parseTimeString(value: string): number | null {
  const parts = value.split(":");
  if (parts.length !== 3) return null;

  const [hours, minutes, seconds] = parts.map(Number);
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;

  return hours * 3600 + minutes * 60 + seconds;
}

export function totalTimelineDurationUs(project: Project): number {
  return sequenceDurationUs(project);
}

function executeRenderPlan(
  plan: RenderPlan,
  cwd: string,
  options: ExportOptions,
  progress?: { offsetSeconds: number; totalSeconds: number },
): Promise<Result<Buffer>> {
  let progressBuffer = "";
  return runMediaProcess("ffmpeg", buildFfmpegArgs(plan), {
    budget: true,
    cpuPercent: MEDIA_SLICE_CPU_PERCENT,
    signal: options.signal,
    cwd,
    onStderr: (chunk) => {
      progressBuffer = (progressBuffer + chunk).slice(-8192);
      const segments = progressBuffer.split(/[\r\n]/);
      progressBuffer = segments.pop() ?? "";
      if (!progress) return;
      for (const segment of segments) {
        const parsed = parseProgress(
          segment.trim(),
          progress.totalSeconds,
          progress.offsetSeconds,
        );
        if (parsed) options.onProgress?.(parsed);
      }
    },
  });
}

function extractValue(line: string, key: string): string | null {
  const start = line.indexOf(key);
  if (start === -1) return null;

  const rest = line.slice(start + key.length).trimStart();
  const end = rest.search(/\s/);
  const value = end === -1 ? rest : rest.slice(0, end);
  return value.length > 0 ? value : null;
}

function parseInteger(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
