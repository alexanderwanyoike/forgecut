import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "../shared/result.js";
import {
  renderCpuPercent,
  type GraphicRenderJob,
} from "./graphic-render-job.js";
import { runGraphicWorker } from "./graphic-worker-process.js";

export function graphicRuntimeDirectory(): string {
  const packaged =
    "resourcesPath" in process && typeof process.resourcesPath === "string"
      ? join(process.resourcesPath, "graphic-runtime")
      : undefined;
  if (packaged && existsSync(join(packaged, "runtime.json"))) return packaged;
  const compiled = fileURLToPath(
    new URL("../graphic-runtime/", import.meta.url),
  );
  if (existsSync(join(compiled, "runtime.json"))) return compiled;
  return fileURLToPath(new URL("../dist/graphic-runtime/", import.meta.url));
}

export async function renderGraphic(
  job: GraphicRenderJob,
  directory: string,
  signal?: AbortSignal,
): Promise<Result<string>> {
  const runtime = graphicRuntimeDirectory();
  if (!existsSync(join(runtime, "runtime.json")))
    return {
      ok: false,
      error: {
        code: "UNAVAILABLE",
        message:
          "Graphics runtime is missing. Prepare it with yarn build:graphic-runtime or reinstall the packaged app.",
      },
    };
  const path = join(directory, "graphic-job.json");
  await writeFile(path, JSON.stringify(job));
  const rendered = await runGraphicWorker(
    runtime,
    path,
    signal,
    job.code !== undefined,
    renderCpuPercent(job.format),
  );
  return rendered.ok ? { ok: true, value: job.output } : rendered;
}
