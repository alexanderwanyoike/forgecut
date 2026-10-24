import { createHash } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { atomicWrite } from "./atomic-file.js";
import type { GraphicResource } from "../shared/graphic-resources.js";
import type { Result } from "../shared/result.js";

export function resourceStorePath(hash: string): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid resource hash");
  return join(
    process.env.FORGECUT_RESOURCE_DIR ??
      join(homedir(), ".forgecut", "resources"),
    hash,
  );
}
export async function readResourceFile(path: string): Promise<Buffer> {
  const file = await open(path, "r");
  try {
    if ((await file.stat()).size > 8 * 1024 * 1024)
      throw new Error("Graphic resource exceeds 8 MiB");
    const bytes = Buffer.alloc(8 * 1024 * 1024 + 1);
    let bytesRead = 0;
    while (bytesRead < bytes.length) {
      const read = await file.read(
        bytes,
        bytesRead,
        bytes.length - bytesRead,
        bytesRead,
      );
      if (read.bytesRead === 0) break;
      bytesRead += read.bytesRead;
    }
    if (bytesRead > 8 * 1024 * 1024)
      throw new Error("Graphic resource exceeds 8 MiB");
    return bytes.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}
export async function storeResource(
  bytes: Buffer,
  hash: string,
): Promise<void> {
  if (resourceHash(bytes) !== hash)
    throw new Error("Graphic resource content hash mismatch");
  const path = resourceStorePath(hash);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await atomicWrite(path, bytes);
}
export function resourceHash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export async function readGraphicResource(
  resource: GraphicResource,
): Promise<Result<Buffer>> {
  try {
    const bytes = await readResourceFile(resourceStorePath(resource.sha256));
    if (resourceHash(bytes) !== resource.sha256)
      return {
        ok: false,
        error: {
          code: "INVALID_RESOURCE",
          message: `Graphic resource content changed: ${resource.name}`,
        },
      };
    return { ok: true, value: bytes };
  } catch (failure) {
    return {
      ok: false,
      error: {
        code: "IO_ERROR",
        message: `Graphic resource unavailable: ${resource.name}. ${failure instanceof Error ? failure.message : String(failure)}`,
      },
    };
  }
}
