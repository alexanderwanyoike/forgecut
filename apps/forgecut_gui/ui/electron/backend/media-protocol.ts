import { extname } from "node:path";

export interface ByteRange {
  start: number;
  end: number;
}

export interface MediaResponseInit {
  status: number;
  headers: Record<string, string>;
  range?: ByteRange;
}

const MIME_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export function mediaMimeType(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Parse an HTTP Range header against a resource of `size` bytes.
 * Returns the requested byte range, null when the header is absent or
 * malformed (serve the full file), or "unsatisfiable" when the range is
 * valid syntax but outside the resource (respond 416).
 * Multi-range requests are answered with the first range only.
 */
export function parseByteRange(
  rangeHeader: string | null,
  size: number,
): ByteRange | null | "unsatisfiable" {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)(?:,|$)/.exec(rangeHeader.trim());
  if (!match) return null;
  const [, startRaw, endRaw] = match;
  if (startRaw === "" && endRaw === "") return null;

  if (startRaw === "") {
    // Suffix range: last N bytes
    const suffix = Number(endRaw);
    if (suffix === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(startRaw);
  if (start >= size) return "unsatisfiable";
  const end = endRaw === "" ? size - 1 : Math.min(Number(endRaw), size - 1);
  if (end < start) return "unsatisfiable";
  return { start, end };
}

/**
 * Compute the HTTP status and headers for serving a media file, honoring
 * Range requests so <video> elements can seek.
 */
export function mediaResponseInit(
  rangeHeader: string | null,
  size: number,
  path: string,
): MediaResponseInit {
  const baseHeaders = {
    "Accept-Ranges": "bytes",
    "Content-Type": mediaMimeType(path),
  };

  const range = parseByteRange(rangeHeader, size);
  if (range === "unsatisfiable") {
    return {
      status: 416,
      headers: { ...baseHeaders, "Content-Range": `bytes */${size}` },
    };
  }
  if (range === null) {
    return {
      status: 200,
      headers: { ...baseHeaders, "Content-Length": String(size) },
    };
  }
  return {
    status: 206,
    headers: {
      ...baseHeaders,
      "Content-Length": String(range.end - range.start + 1),
      "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
    },
    range,
  };
}
