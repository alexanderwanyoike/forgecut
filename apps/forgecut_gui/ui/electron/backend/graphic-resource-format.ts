import { imageSize } from "image-size";
import type { GraphicResource } from "../shared/graphic-resources.js";
import type { Result } from "../shared/result.js";

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

export function inspectGraphicResource(
  bytes: Buffer,
  kind: GraphicResource["kind"],
): Result<Pick<GraphicResource, "mime" | "width" | "height">> {
  const mime = mimeOf(bytes);
  if (!mime || !mime.startsWith(kind === "Image" ? "image/" : "font/"))
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Unsupported graphic resource format or kind",
      },
    };
  if (kind === "Font") return { ok: true, value: { mime } };
  try {
    const { width, height } = imageSize(bytes);
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width > 8192 ||
      height > 8192 ||
      width * height > 33554432
    )
      return {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: "Artwork exceeds 8192 pixels per side or 32 megapixels",
        },
      };
    return { ok: true, value: { mime, width, height } };
  } catch (failure) {
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: `Invalid artwork header: ${failure instanceof Error ? failure.message : String(failure)}`,
      },
    };
  }
}
