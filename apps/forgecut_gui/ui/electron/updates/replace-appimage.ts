import { chmod, copyFile, rename, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Result } from "../shared/result.js";

export async function replaceAppImage(
  installed: string,
  downloaded: string,
): Promise<Result<undefined>> {
  const temporary = `${installed}.${randomUUID()}.tmp`;
  try {
    const original = await stat(installed);
    await copyFile(downloaded, temporary);
    await chmod(temporary, original.mode & 0o777);
    // Same-directory rename preserves the original executable until the complete replacement is ready.
    await rename(temporary, installed);
    return { ok: true, value: undefined };
  } catch {
    return {
      ok: false,
      error: {
        code: "UPDATE_INSTALL_FAILED",
        message:
          "Could not replace the AppImage. Check that its folder is writable and retry.",
      },
    };
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}
