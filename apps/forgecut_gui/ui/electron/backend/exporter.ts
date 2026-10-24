import { mkdtemp, rm, writeFile, open, rename } from "node:fs/promises";
import { join, dirname, resolve as resolvePath } from "node:path";
import type { Result } from "../shared/result.js";
import { runMediaProcess } from "./media-process.js";
import type { Project } from "./state.js";
import { compileExportPlan, type RenderPlan } from "./export-plan.js";
import { sequenceDurationUs } from "../domain/sequence.js";

import { prepareGraphicInputs } from "./prepare-graphic-inputs.js";

export { compileExportPlan } from "./export-plan.js";
export type { RenderPlan, RenderInput } from "./export-plan.js";

export type RenderProgress = {
  percent: number;
  frame: number;
  fps: number;
  speed: string;
  eta_seconds: number | null;
};

type ExportOptions = {
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
  let directory: string | undefined;
  let result: Result<ExportOutcome>;
  try {
    const destination = resolvePath(outputPath);
    directory = await mkdtemp(join(dirname(destination), ".forgecut-export-"));
    const prepared = await prepareGraphicInputs(
      project,
      directory,
      options.signal,
    );
    if (!prepared.ok) result = prepared;
    else {
      const plan = compileExportPlan(prepared.value);
      plan.outputPath = join(directory, "render.mp4");
      result = await renderPrepared(
        plan,
        {
          directory,
          destination,
          totalSeconds: totalTimelineDurationUs(project) / 1_000_000,
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
  plan: RenderPlan,
  target: { directory: string; destination: string; totalSeconds: number },
  options: ExportOptions,
): Promise<Result<ExportOutcome>> {
  for (const file of plan.textFiles)
    await writeFile(join(target.directory, file.name), file.content);
  const rendered = await executeRenderPlan(
    plan,
    target.totalSeconds,
    target.directory,
    options,
  );
  if (!rendered.ok) return rendered;
  const file = await open(plan.outputPath, "r");
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
  await rename(plan.outputPath, target.destination);
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
    "1",
    "-filter_complex_threads",
    "1",
    ...plan.inputs.flatMap((input) => [
      "-threads",
      "1",
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
): RenderProgress | null {
  if (!line.includes("time=")) return null;

  const frame = parseInteger(extractValue(line, "frame=")) ?? 0;
  const fps = parseNumber(extractValue(line, "fps=")) ?? 0;
  const speed = extractValue(line, "speed=") ?? "";
  const timeSeconds = parseTimeString(extractValue(line, "time=") ?? "") ?? 0;
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
  totalSeconds: number,
  cwd: string,
  options: ExportOptions,
): Promise<Result<Buffer>> {
  let progressBuffer = "";
  return runMediaProcess("ffmpeg", buildFfmpegArgs(plan), {
    budget: true,
    signal: options.signal,
    cwd,
    onStderr: (chunk) => {
      progressBuffer = (progressBuffer + chunk).slice(-8192);
      const segments = progressBuffer.split(/[\r\n]/);
      progressBuffer = segments.pop() ?? "";
      for (const segment of segments) {
        const progress = parseProgress(segment.trim(), totalSeconds);
        if (progress) options.onProgress?.(progress);
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
