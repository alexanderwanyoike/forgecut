import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { GraphicComponent } from "../shared/graphics.js";
import type { GraphicCompilation } from "../shared/graphic-source.js";
import type { Result } from "../shared/result.js";
import { runSourceCompiler } from "./source-compiler-process.js";

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
    const runtime = codeRuntimeDirectory();
    if (!existsSync(join(runtime, "compiler.cjs")))
      outcome = {
        ok: false,
        error: {
          code: "UNAVAILABLE",
          message:
            "The source compiler is missing. Build the code runtime or reinstall ForgeCut.",
        },
      };
    else {
      const input = join(directory, "source.json");
      await writeFile(input, JSON.stringify(source));
      outcome = await runSourceCompiler(runtime, input, directory, signal);
    }
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
