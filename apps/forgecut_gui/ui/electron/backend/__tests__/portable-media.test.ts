/** @vitest-environment node */
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { AppState } from "../state";
import type { Project } from "../../shared/ipc-contract";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it("reopens local media after moving a project folder while preserving external recordings and live history", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecut-portable-"));
  directories.push(root);
  const original = join(root, "project");
  const media = join(original, "media");
  await mkdir(media, { recursive: true });
  const local = join(media, "title.png");
  const external = join(root, "recording.png");
  await writeFile(local, "local media");
  await writeFile(external, "external media");
  const state = new AppState();
  state.executeProjectChange((project) => {
    project.assets.push(
      ...[local, external].map((path, index) => ({
        id: `asset-${index}`,
        name: `Image ${index}`,
        path,
        kind: "Image" as const,
        probe: null,
      })),
    );
  });
  const before = state.snapshot();
  await state.saveProject(join(original, "edit.forgecut"));
  const saved: Project = JSON.parse(
    await readFile(join(original, "edit.forgecut"), "utf8"),
  );
  expect(saved.assets.map((asset) => asset.path)).toEqual([
    "media/title.png",
    external,
  ]);
  expect(saved.schema_version).toBe(8);
  expect(state.snapshot()).toEqual(before);
  const moved = join(root, "moved");
  await rename(original, moved);
  const reopened = new AppState();
  await reopened.loadProject(join(moved, "edit.forgecut"));
  expect(reopened.project.assets.map((asset) => asset.path)).toEqual([
    join(moved, "media", "title.png"),
    external,
  ]);
  expect(reopened.snapshot().missingMedia).toEqual([]);
  await rm(external);
  await reopened.loadProject(join(moved, "edit.forgecut"));
  expect(reopened.snapshot().missingMedia).toEqual(["asset-1"]);
});

it("keeps media external when saving a document elsewhere and preserves foreign drive paths for relinking", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecut-save-as-"));
  directories.push(root);
  const original = join(root, "original");
  const elsewhere = join(root, "elsewhere");
  await mkdir(original);
  await mkdir(elsewhere);
  const local = join(original, "clip.png");
  await writeFile(local, "media");
  const state = new AppState();
  state.executeProjectChange((project) => {
    project.assets.push(
      { id: "local", name: "Clip", path: local, kind: "Image", probe: null },
      {
        id: "foreign",
        name: "External recording",
        path: "C:\\Recordings\\take.mp4",
        kind: "Video",
        probe: null,
      },
    );
  });
  await state.saveProject(join(original, "edit.forgecut"));
  const reopened = new AppState();
  await reopened.loadProject(join(original, "edit.forgecut"));
  await reopened.saveProject(join(elsewhere, "edit.forgecut"));
  const saved: Project = JSON.parse(
    await readFile(join(elsewhere, "edit.forgecut"), "utf8"),
  );
  expect(saved.assets.map((asset) => asset.path)).toEqual([
    local,
    "C:\\Recordings\\take.mp4",
  ]);
  const again = new AppState();
  await again.loadProject(join(elsewhere, "edit.forgecut"));
  expect(again.snapshot().missingMedia).toEqual(["foreign"]);
});
