import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { inspectGraphicResource } from "./graphic-resource-format.js";
import { EditingError } from "./editing-error.js";
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
export async function readResourceFile(
  path: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  const checkCancelled = () => {
    if (signal?.aborted)
      throw new EditingError("CANCELLED", "Resource read cancelled");
  };
  checkCancelled();
  // Nonblocking read-only opens let us reject pipes before they can stall a job.
  const flags = process.platform === "win32" ? "r" : constants.O_NONBLOCK;
  const file = await open(path, flags);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile())
      throw new EditingError(
        "INVALID_INPUT",
        "Graphic resources and licences must be regular files",
      );
    if (metadata.size > 8 * 1024 * 1024)
      throw new Error("Graphic resource exceeds 8 MiB");
    const bytes = Buffer.alloc(8 * 1024 * 1024 + 1);
    let bytesRead = 0;
    while (bytesRead < bytes.length) {
      checkCancelled();
      const read = await file.read(
        bytes,
        bytesRead,
        Math.min(bytes.length - bytesRead, 65536),
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
    const inspected = inspectGraphicResource(bytes, resource.kind);
    if (!inspected.ok) return inspected;
    if (inspected.value.mime !== resource.mime)
      return {
        ok: false,
        error: {
          code: "INVALID_RESOURCE",
          message: "Resource media type does not match its content",
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
