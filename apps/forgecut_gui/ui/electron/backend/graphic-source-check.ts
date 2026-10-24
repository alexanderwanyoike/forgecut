import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { GraphicComponent } from "../shared/graphics.js";
import type { GraphicCompilation } from "../shared/graphic-source.js";
import type { Result } from "../shared/result.js";
import { budgetedMediaCommand } from "./process-budget.js";

const compilationSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    value: z.strictObject({ code: z.string().max(2097152) }),
  }),
  z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({
      code: z.literal("INVALID_SOURCE"),
      message: z.string().max(8192),
      diagnostics: z
        .array(
          z.strictObject({
            file: z.string().max(512),
            line: z.number().int().positive(),
            column: z.number().int().positive(),
            message: z.string().max(8192),
          }),
        )
        .max(100),
    }),
  }),
]);
export function codeRuntimeDirectory(): string {
  const packaged =
    "resourcesPath" in process && typeof process.resourcesPath === "string"
      ? join(process.resourcesPath, "code-runtime")
      : undefined;
  if (packaged && existsSync(join(packaged, "compiler.cjs"))) return packaged;
  const compiled = fileURLToPath(new URL("../code-runtime/", import.meta.url));
  if (existsSync(join(compiled, "compiler.cjs"))) return compiled;
  return fileURLToPath(new URL("../dist/code-runtime/", import.meta.url));
}
export async function checkGraphicSource(
  source: GraphicComponent["source"],
  signal?: AbortSignal,
): Promise<Result<GraphicCompilation>> {
  let directory = "";
  let outcome: Result<GraphicCompilation>;
  try {
    directory = await mkdtemp(join(tmpdir(), "forgecut-source-"));
    outcome = await (async (): Promise<Result<GraphicCompilation>> => {
      const runtime = codeRuntimeDirectory();
      if (!existsSync(join(runtime, "compiler.cjs")))
        return {
          ok: false,
          error: {
            code: "UNAVAILABLE",
            message:
              "The source compiler is missing. Build the code runtime or reinstall ForgeCut.",
          },
        };
      const input = join(directory, "source.json");
      await writeFile(input, JSON.stringify(source));
      const invocation = await budgetedMediaCommand(process.execPath, [
        "--max-old-space-size=512",
        join(runtime, "compiler.cjs"),
        input,
      ]);
      if (signal?.aborted)
        return {
          ok: false,
          error: { code: "CANCELLED", message: "Source check cancelled" },
        };
      return await new Promise<Result<GraphicCompilation>>((resolve) => {
        const child = spawn(invocation.command, invocation.args, {
          cwd: directory,
          detached: process.platform !== "win32",
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            ESBUILD_BINARY_PATH: join(
              runtime,
              process.platform === "win32" ? "esbuild.exe" : "esbuild",
            ),
          },
        });
        const output: Buffer[] = [];
        let outputBytes = 0;
        let stderr = "";
        let failure = "";
        let cancelled = false;
        let timedOut = false;
        const stop = () => {
          if (invocation.unit)
            execFile(
              "systemctl",
              ["--user", "kill", "--signal=SIGKILL", invocation.unit],
              { timeout: 2000 },
              () => {},
            );
          if (!child.pid) return;
          if (process.platform === "win32")
            execFile(
              "taskkill",
              ["/pid", String(child.pid), "/t", "/f"],
              { timeout: 2000 },
              () => {},
            );
          else {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              child.kill("SIGKILL");
            }
          }
        };
        const abort = () => {
          cancelled = true;
          stop();
        };
        const deadline = setTimeout(() => {
          timedOut = true;
          stop();
        }, 15000);
        signal?.addEventListener("abort", abort, { once: true });
        child.stdout.on("data", (chunk: Buffer) => {
          outputBytes += chunk.length;
          if (outputBytes > 4194304) {
            failure = "Compiler output exceeded 4 MiB";
            stop();
          } else output.push(chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr = (stderr + chunk.toString()).slice(-8192);
        });
        child.on("error", (error) => {
          failure = error.message;
        });
        child.on("close", (code) => {
          clearTimeout(deadline);
          signal?.removeEventListener("abort", abort);
          if (cancelled || signal?.aborted) {
            resolve({
              ok: false,
              error: { code: "CANCELLED", message: "Source check cancelled" },
            });
            return;
          }
          if (timedOut) {
            resolve({
              ok: false,
              error: {
                code: "TIMEOUT",
                message: "Source compilation exceeded 15 seconds",
              },
            });
            return;
          }
          if (failure || code !== 0) {
            resolve({
              ok: false,
              error: {
                code: "IO_ERROR",
                message: failure || stderr || "Source compiler failed",
              },
            });
            return;
          }
          try {
            resolve({
              ok: true,
              value: compilationSchema.parse(
                JSON.parse(Buffer.concat(output).toString("utf8")),
              ),
            });
          } catch {
            resolve({
              ok: false,
              error: {
                code: "IO_ERROR",
                message: "Invalid source compiler response",
              },
            });
          }
        });
        if (signal?.aborted) abort();
      });
    })();
  } catch (failure) {
    outcome = {
      ok: false,
      error: {
        code: "IO_ERROR",
        message: failure instanceof Error ? failure.message : String(failure),
      },
    };
  }
  if (directory) {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (failure) {
      const cleanup = `Temporary compiler cleanup failed: ${failure instanceof Error ? failure.message : String(failure)}`;
      if (!outcome.ok)
        outcome = {
          ok: false,
          error: {
            ...outcome.error,
            message: `${outcome.error.message}; ${cleanup}`,
          },
        };
      else if (!outcome.value.ok)
        outcome = {
          ok: true,
          value: {
            ok: false,
            error: {
              ...outcome.value.error,
              message: `${outcome.value.error.message}; ${cleanup}`,
            },
          },
        };
      else
        outcome = { ok: false, error: { code: "IO_ERROR", message: cleanup } };
    }
  }
  return outcome;
}
