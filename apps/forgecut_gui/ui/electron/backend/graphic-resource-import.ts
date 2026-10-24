import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type {
  GraphicResource,
  ResourceLicense,
} from "../shared/graphic-resources.js";
import type { Result } from "../shared/result.js";
import {
  readResourceFile,
  resourceHash,
  storeResource,
} from "./graphic-resource-store.js";

function mimeOf(bytes: Buffer): GraphicResource["mime"] | undefined {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  const tag = bytes.toString("ascii", 0, 4);
  if (tag === "OTTO") return "font/otf";
  if (tag === "wOFF") return "font/woff";
  if (tag === "wOF2") return "font/woff2";
  if (bytes.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0])) || tag === "true")
    return "font/ttf";
  return undefined;
}
export async function importGraphicResource(
  path: string,
  kind: GraphicResource["kind"],
  license: ResourceLicense,
): Promise<Result<GraphicResource>> {
  try {
    const bytes = await readResourceFile(path);
    const mime = mimeOf(bytes);
    if (!mime || !mime.startsWith(kind === "Image" ? "image/" : "font/"))
      return {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: "Unsupported graphic resource format or kind",
        },
      };
    const sha256 = resourceHash(bytes);
    await storeResource(bytes, sha256);
    return {
      ok: true,
      value: {
        id: randomUUID(),
        name: basename(path),
        kind,
        mime,
        sha256,
        path: `.forgecut-resources/${sha256}`,
        license,
      },
    };
  } catch (failure) {
    return {
      ok: false,
      error: {
        code: "IO_ERROR",
        message: failure instanceof Error ? failure.message : String(failure),
      },
    };
  }
}
