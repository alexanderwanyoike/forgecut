/** @vitest-environment node */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { extractThumbnailsBase64, extractWaveform } from "../media-derived";

const { mockExecute } = vi.hoisted(() => ({ mockExecute: vi.fn() }));
vi.mock("node:child_process", () => ({
  execFile: Object.assign(mockExecute, { [Symbol.for("nodejs.util.promisify.custom")]: mockExecute }),
}));

it("refreshes cached thumbnails and waveforms when the same asset is relinked or its file changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-media-cache-"));
  const firstPath = join(directory, "first.media");
  const secondPath = join(directory, "replacement.media");
  await writeFile(firstPath, "100");
  await writeFile(secondPath, "200");
  const assetId = randomUUID();
  mockExecute.mockImplementation(async (_command: string, args: string[]) => {
    const source = args[args.indexOf("-i") + 1];
    const content = await readFile(source, "utf8");
    if (args.includes("-vframes")) await writeFile(args.at(-1)!, content);
    const pcm = Buffer.alloc(8);
    for (let offset = 0; offset < pcm.length; offset += 2) pcm.writeInt16LE(Number(content), offset);
    return { stdout: pcm };
  });
  const first = await extractThumbnailsBase64(firstPath, assetId, 1);
  expect(await extractThumbnailsBase64(firstPath, assetId, 1)).toEqual(first);
  expect(mockExecute).toHaveBeenCalledTimes(1);
  const wave = await extractWaveform(firstPath, assetId, 2);
  const replacement = await extractThumbnailsBase64(secondPath, assetId, 1);
  expect(replacement[0].data_uri).not.toBe(first[0].data_uri);
  expect((await extractWaveform(secondPath, assetId, 2)).peaks).not.toEqual(wave.peaks);
  await writeFile(secondPath, "3000");
  expect((await extractThumbnailsBase64(secondPath, assetId, 1))[0].data_uri).not.toBe(replacement[0].data_uri);
});
