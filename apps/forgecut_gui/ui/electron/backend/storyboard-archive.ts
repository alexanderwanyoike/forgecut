import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { open, type ZipFile } from "yauzl";
import { storyboardMediaPath } from "./storyboard-manifest.js";

export async function extractStoryboardArchive(source: string, directory: string, signal?: AbortSignal): Promise<Set<string>> {
  const zip = await new Promise<ZipFile>((resolve, reject) => {
    open(source, { lazyEntries: true, validateEntrySizes: true }, (error, archive) => {
      if (error || !archive) reject(error ?? new Error("Cannot open storyboard package"));
      else resolve(archive);
    });
  });
  return new Promise((resolve, reject) => {
    const entries = new Set<string>();
    let totalBytes = 0;
    const fail = (cause: unknown) => { zip.close(); reject(cause); };
    const abort = () => fail(new Error("Storyboard import cancelled"));
    signal?.addEventListener("abort", abort, { once: true });
    zip.on("close", () => signal?.removeEventListener("abort", abort));
    zip.on("error", fail);
    zip.on("end", () => resolve(entries));
    zip.on("entry", (entry) => {
      void (async () => {
        if (signal?.aborted) throw new Error("Storyboard import cancelled");
        const name = entry.fileName;
        totalBytes += entry.uncompressedSize;
        if (entries.has(name) || entries.size >= 30001 || totalBytes > 16 * 1024 ** 3 ||
            (name !== "storyboard.json" && !storyboardMediaPath.test(name)) ||
            (name === "storyboard.json" && entry.uncompressedSize > 1024 ** 2) ||
            ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) {
          throw new Error("Invalid or oversized storyboard archive entry");
        }
        entries.add(name);
        const destination = join(directory, name);
        await mkdir(dirname(destination), { recursive: true });
        const stream = await new Promise<NodeJS.ReadableStream>((done, failed) => {
          zip.openReadStream(entry, (error, input) => {
            if (error || !input) failed(error ?? new Error("Cannot read archive entry"));
            else done(input);
          });
        });
        await pipeline(stream, createWriteStream(destination, { flags: "wx", mode: 0o600 }), { signal });
        zip.readEntry();
      })().catch(fail);
    });
    if (signal?.aborted) abort(); else zip.readEntry();
  });
}
