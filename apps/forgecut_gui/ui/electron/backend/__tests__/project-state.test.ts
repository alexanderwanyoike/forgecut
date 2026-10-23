/** @vitest-environment node */
import { mkdtemp, readFile, readdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppState } from "../state";

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, rename: vi.fn(fs.rename) };
});

afterEach(() => vi.mocked(rename).mockReset());

describe("project transactions and history", () => {
  it("commits settings, assets and timeline together and undoes the whole edit", () => {
    const state = new AppState();
    const initial = state.snapshot();
    const events = vi.fn();
    state.subscribe(events);
    state.executeProjectChange((project) => {
      project.name = "Film";
      project.settings.fps = 24;
      project.assets.push({ id: "image", name: "title.png", path: "/missing/title.png", kind: "Image", probe: null });
      project.timeline.tracks.push({ id: "images", kind: "OverlayImage", items: [] });
    });
    const edited = state.snapshot();
    expect(edited.revision).toBe(initial.revision + 1);
    expect(events).toHaveBeenCalledTimes(1);
    state.undo();
    expect(state.project).toEqual(initial.project);
    state.redo();
    expect(state.project).toEqual(edited.project);
    expect(state.revision).toBe(edited.revision + 2);
    const detached = state.snapshot();
    detached.project.name = "Do not mutate the owner";
    expect(state.project.name).toBe("Film");
  });

  it("rejects invalid drafts without discarding redo or notifying listeners", () => {
    const state = new AppState();
    state.executeProjectChange((project) => { project.name = "First"; });
    state.undo();
    const before = state.snapshot();
    const events = vi.fn();
    state.subscribe(events);
    expect(() => state.executeProjectChange((project) => {
      project.name = "Partial edit";
      project.settings.fps = NaN;
    })).toThrow();
    expect(state.snapshot()).toEqual(before);
    expect(events).not.toHaveBeenCalled();
    state.redo();
    expect(state.project.name).toBe("First");
  });

  it("coalesces one interaction, closes groups on undo, and bounds history by count and bytes", () => {
    const state = new AppState({ count: 2 });
    state.executeProjectChange((project) => { project.name = "a"; }, { group: "typing" });
    state.executeProjectChange((project) => { project.name = "ab"; }, { group: "typing" });
    state.undo();
    expect(state.project.name).toBe("Untitled");
    state.redo();
    state.executeProjectChange((project) => { project.name = "abc"; }, { group: "typing" });
    state.undo();
    expect(state.project.name).toBe("ab");
    const tiny = new AppState({ bytes: 1 });
    tiny.executeProjectChange((project) => { project.name = "Large"; });
    expect(tiny.snapshot().canUndo).toBe(false);
    state.executeProjectChange((project) => { project.name = "2"; });
    state.executeProjectChange((project) => { project.name = "3"; });
    state.executeProjectChange((project) => { project.name = "4"; });
    state.undo(); state.undo();
    expect(() => state.undo()).toThrow("Nothing to undo");
  });
});

describe("versioned project persistence", () => {
  it("migrates unversioned files, reports missing media, and rejects future or corrupt projects without replacing the open project", async () => {
    const state = new AppState();
    const dir = await mkdtemp(join(tmpdir(), "forgecut-schema-"));
    const path = join(dir, "legacy.forgecut");
    const legacy = structuredClone(state.project);
    delete legacy.schema_version;
    legacy.assets.push({ id: "missing", name: "gone.png", path: join(dir, "gone.png"), kind: "Image", probe: null });
    await writeFile(path, JSON.stringify(legacy));
    await state.loadProject(path);
    expect(state.project.schema_version).toBe(1);
    expect(state.snapshot().missingMedia).toEqual(["missing"]);
    const before = state.snapshot();
    for (const invalid of [{ ...legacy, schema_version: 999 }, { ...legacy, settings: { ...legacy.settings, fps: -1 } }, {}]) {
      await writeFile(path, JSON.stringify(invalid));
      await expect(state.loadProject(path)).rejects.toThrow();
      expect(state.snapshot()).toEqual(before);
    }
  });

  it("keeps a valid primary and recovery copy if replacing the file fails", async () => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(rename).mockImplementation(actual.rename);
    const state = new AppState();
    const dir = await mkdtemp(join(tmpdir(), "forgecut-atomic-"));
    const path = join(dir, "film.forgecut");
    await state.saveProject(path);
    const original = await readFile(path, "utf8");
    state.executeProjectChange((project) => { project.name = "Next"; });
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (to === path) throw new Error("Simulated interrupted replacement");
      return actual.rename(from, to);
    });
    await expect(state.saveProject(path)).rejects.toThrow("interrupted");
    expect(await readFile(path, "utf8")).toBe(original);
    expect(await readFile(`${path}.bak`, "utf8")).toBe(original);
    expect((await readdir(dir)).some((file) => file.endsWith(".tmp"))).toBe(false);
    await writeFile(path, "broken");
    await state.loadProject(path, true);
    expect(state.project.name).toBe("Untitled");
    vi.mocked(rename).mockImplementation(actual.rename);
    await state.saveProject(path);
    expect(JSON.parse(await readFile(path, "utf8")).schema_version).toBe(1);
  });
});
