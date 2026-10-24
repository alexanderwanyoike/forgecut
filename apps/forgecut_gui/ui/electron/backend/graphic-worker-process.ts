import { spawn, execFile } from "node:child_process";
import { join } from "node:path";
import type { Result } from "../shared/result.js";
import { budgetedMediaCommand } from "./process-budget.js";

export async function runGraphicWorker(
  runtime: string,
  jobPath: string,
  signal?: AbortSignal,
): Promise<Result<null>> {
  const invocation = await budgetedMediaCommand(process.execPath, [
    join(runtime, "worker.cjs"),
    jobPath,
  ]);
  return new Promise((resolve) => {
    const cancelled = (): Result<null> => ({
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
      } else resolve({ ok: true, value: null });
    });
  });
}
