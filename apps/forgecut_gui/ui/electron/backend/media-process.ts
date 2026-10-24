import { spawn } from "node:child_process";
import type { Result } from "../shared/result.js";

export function runMediaProcess(
  executable: "ffmpeg" | "ffprobe",
  args: string[],
  options: { signal?: AbortSignal; maxOutputBytes?: number } = {},
): Promise<Result<Buffer>> {
  return new Promise((resolve) => {
    const cancelled = (): Result<Buffer> => ({
      ok: false,
      error: { code: "CANCELLED", message: "Media operation cancelled." },
    });
    if (options.signal?.aborted) {
      resolve(cancelled());
      return;
    }
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      signal: options.signal,
      killSignal: "SIGKILL",
    });
    const output: Buffer[] = [];
    let bytes = 0;
    let stderr = "";
    let failure: Error | undefined;
    let overflow = false;
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > (options.maxOutputBytes ?? 512 * 1024)) {
        overflow = true;
        child.kill("SIGKILL");
      } else output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8192);
    });
    child.on("error", (error) => {
      failure = error;
    });
    // Abort emits an error before exit. Keep the queue slot until the child closes.
    child.on("close", (code) => {
      if (options.signal?.aborted) resolve(cancelled());
      else if (overflow)
        resolve({
          ok: false,
          error: {
            code: "TOO_LARGE",
            message: "Media output exceeded its size limit.",
          },
        });
      else if (failure || code !== 0)
        resolve({
          ok: false,
          error: {
            code: "IO_ERROR",
            message:
              failure?.message ??
              (stderr || `${executable} exited with code ${String(code)}.`),
          },
        });
      else resolve({ ok: true, value: Buffer.concat(output) });
    });
  });
}
