import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "../shared/result.js";
import type { GraphicRenderJob } from "./graphic-render-job.js";
import { budgetedMediaCommand } from "./process-budget.js";

function runtimeDirectory(): string {
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
  const runtime = runtimeDirectory();
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
  const invocation = await budgetedMediaCommand(process.execPath, [
    join(runtime, "worker.cjs"),
    path,
  ]);
  return new Promise((resolve) => {
    const cancelled = (): Result<string> => ({
      ok: false,
      error: { code: "CANCELLED", message: "Graphics render cancelled." },
    });
    if (signal?.aborted) {
      resolve(cancelled());
      return;
    }
    const child = spawn(invocation.command, invocation.args, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "ignore", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    let stderr = "";
    let failure: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let cleanup: Promise<void> | undefined;
    const killTree = (): Promise<void> => {
      cleanup ??= new Promise<void>((done) => {
        if (child.pid && process.platform !== "win32") {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {}
        } else if (child.pid) {
          execFile(
            "taskkill",
            ["/pid", String(child.pid), "/T", "/F"],
            { timeout: 3000 },
            () => done(),
          );
          return;
        } else child.kill("SIGKILL");
        if (invocation.unit)
          execFile(
            "systemctl",
            [
              "--user",
              "kill",
              "--kill-whom=all",
              "--signal=SIGKILL",
              invocation.unit,
            ],
            { timeout: 2000 },
            () => done(),
          );
        else done();
      });
      return cleanup;
    };
    const abort = () => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        void killTree();
      }, 3000);
    };
    signal?.addEventListener("abort", abort, { once: true });
    const deadline = setTimeout(abort, 15 * 60 * 1000);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8192);
    });
    child.on("error", (error) => {
      failure = error;
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      clearTimeout(deadline);
      if (killTimer) clearTimeout(killTimer);
      if (signal?.aborted) {
        void killTree().then(() => resolve(cancelled()));
      } else if (failure || code !== 0) {
        void killTree().then(() =>
          resolve({
            ok: false,
            error: {
              code: "RENDER_FAILED",
              message:
                failure?.message ??
                (stderr || `Graphics worker exited with ${String(code)}.`),
            },
          }),
        );
      } else resolve({ ok: true, value: job.output });
    });
  });
}
