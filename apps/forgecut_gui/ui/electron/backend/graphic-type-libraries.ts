import { open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Result } from "../shared/result.js";
import { codeRuntimeDirectory } from "./graphic-source-check.js";

export async function readGraphicTypeLibraries(): Promise<
  Result<
    Record<string, string>,
    { code: "UNAVAILABLE" | "IO_ERROR"; message: string }
  >
> {
  try {
    const file = await open(join(codeRuntimeDirectory(), "types.json"), "r");
    try {
      const metadata = await file.stat();
      if (!metadata.isFile() || metadata.size > 8 * 1024 * 1024)
        return {
          ok: false,
          error: {
            code: "IO_ERROR",
            message: "Prepared type libraries are invalid or exceed 8 MiB",
          },
        };
      const libraries = z
        .record(z.string(), z.string())
        .parse(JSON.parse(await file.readFile("utf8")));
      return {
        ok: true,
        value: Object.fromEntries(
          Object.entries(libraries).filter(([path]) =>
            path.startsWith("/forgecut/node_modules/"),
          ),
        ),
      };
    } finally {
      await file.close();
    }
  } catch (failure) {
    return {
      ok: false,
      error: {
        code:
          (failure as NodeJS.ErrnoException).code === "ENOENT"
            ? "UNAVAILABLE"
            : "IO_ERROR",
        message: `Prepared package types are unavailable. Build the code runtime or reinstall ForgeCut. ${failure instanceof Error ? failure.message : String(failure)}`,
      },
    };
  }
}
