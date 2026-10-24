import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { tmpdir } from "node:os";
import type { Project } from "./state.js";
import { compileExportPlan, type RenderPlan } from "./export-plan.js";
import { sequenceDurationUs } from "./sequence.js";

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
  onProgress?: (progress: RenderProgress) => void;
};

export async function exportProject(
  project: Project,
  outputPath: string,
  options: ExportOptions = {},
): Promise<void> {
  const plan = compileExportPlan(project);
  plan.outputPath = outputPath;

  await executeRenderPlan(
    plan,
    totalTimelineDurationUs(project) / 1_000_000,
    options.onProgress,
  );
}

export function buildFfmpegArgs(plan: RenderPlan): string[] {
  return [
    "-y",
    "-hide_banner",
    "-threads",
    "1",
    "-filter_complex_threads",
    "1",
    ...plan.inputs.flatMap((input) => ["-threads", "1", "-i", resolvePath(input.path)]),
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

async function executeRenderPlan(
  plan: RenderPlan,
  totalSeconds: number,
  onProgress: ExportOptions["onProgress"],
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-render-"));
  for (const file of plan.textFiles)
    await writeFile(join(directory, file.name), file.content);
  plan.outputPath = resolvePath(plan.outputPath);
  return new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", buildFfmpegArgs(plan), {
      stdio: ["ignore", "ignore", "pipe"],
      cwd: directory,
    });
    const stderrTail: string[] = [];
    let progressBuffer = "";

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new Error("ffmpeg not found"));
        return;
      }
      reject(error);
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderrTail.push(chunk);
      if (stderrTail.length > 20) stderrTail.shift();

      progressBuffer += chunk;
      const segments = progressBuffer.split(/[\r\n]/);
      progressBuffer = segments.pop() ?? "";
      for (const segment of segments) {
        const progress = parseProgress(segment.trim(), totalSeconds);
        if (progress) onProgress?.(progress);
      }
    });

    child.on("close", (code, signal) => {
      const progress = parseProgress(progressBuffer.trim(), totalSeconds);
      if (progress) onProgress?.(progress);

      if (code === 0) {
        resolve();
        return;
      }

      const status = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(
        new Error(
          `ffmpeg failed with ${status}: ${stderrTail.join("").trim()}`,
        ),
      );
    });
  }).finally(() => rm(directory, { recursive: true, force: true }));
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
