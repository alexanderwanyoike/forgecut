/** @vitest-environment node */
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { afterEach, expect, it, vi } from "vitest";
import { ZipFile } from "yazl";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-storyboard-"));
  directories.push(directory);
  vi.stubEnv("FORGECUT_STORYBOARD_DIR", join(directory, "imported"));
  const archive = join(directory, "Opening.sbz");
  const zip = new ZipFile();
  zip.addBuffer(
    Buffer.from(
      JSON.stringify({
        format: "showbiz-storyboard",
        version: 1,
        storyboard: { id: "sb", name: "Opening" },
        shots: [
          {
            id: "shot-a",
            order: 1,
            duration: 8,
            media: [{ role: "image", path: "shots/0001/image.png" }],
          },
        ],
      }),
    ),
    "storyboard.json",
  );
  zip.addBuffer(image, "shots/0001/image.png");
  const completion = pipeline(zip.outputStream, createWriteStream(archive));
  zip.end();
  await completion;
  return { archive, directory };
}
it("imports an SBZ into durable project media without changing any sequence", async () => {
  const { archive } = await fixture();
  const state = new AppState();
  const before = structuredClone(state.project.sequences);
  const service = new EditingService(state);
  const result = await service.execute("import_assets", { paths: [archive] });
  expect(result).toMatchObject({ ok: true });
  expect(state.project.assets).toHaveLength(1);
  expect(state.project.sequences).toEqual(before);
  const asset = state.project.assets[0];
  expect(asset.name).toBe("Opening - Shot 1 - image");
  await rm(archive);
  expect(await readFile(asset.path)).toEqual(image);
});
