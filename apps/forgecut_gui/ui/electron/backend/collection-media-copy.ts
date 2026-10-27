import { constants, createWriteStream } from "node:fs";
import { open } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import type { Result } from "../shared/result.js";

export async function copyCollectionMedia(
  path: string,
  destination: string,
  signal: AbortSignal,
  report: (progress: number) => void,
): Promise<Result<void>> {
  try {
    const source = await open(
      path,
      process.platform === "win32" ? "r" : constants.O_NONBLOCK,
    );
    try {
      const metadata = await source.stat();
      if (!metadata.isFile())
        return {
          ok: false,
          error: {
            code: "INVALID_INPUT",
            message: "Collected media must be regular files",
          },
        };
      const readable = source.createReadStream({
        autoClose: false,
        highWaterMark: 65536,
      });
      let copied = 0;
      readable.on("data", (chunk) => {
        copied += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
        report(Math.min(1, copied / Math.max(1, metadata.size)));
      });
      await pipeline(
        readable,
        createWriteStream(destination, {
          flags: "wx",
          mode: 0o600,
          highWaterMark: 65536,
        }),
        { signal },
      );
      if (copied !== metadata.size)
        return {
          ok: false,
          error: {
            code: "IO_ERROR",
            message: "Source media changed size while collecting",
          },
        };
      return { ok: true, value: undefined };
    } finally {
      await source.close();
    }
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: signal.aborted ? "CANCELLED" : "IO_ERROR",
        message: cause instanceof Error ? cause.message : String(cause),
      },
    };
  }
}
