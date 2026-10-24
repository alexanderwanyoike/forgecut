/** @vitest-environment node */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

it("retains recording and music credits across sequences, global undo and project reopening", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-credits-"));
  const state = new AppState();
  state.executeProjectChange((project) => {
    project.assets.push({
      id: "music",
      name: "Low-profile heartbeat",
      path: join(directory, "music.ogg"),
      kind: "Audio",
      probe: null,
    });
  });
  const service = new EditingService(state);
  const license = {
    identifier: "Supplied music",
    text: "Permission supplied with the project.",
    attribution: "Signal Transit / Low-profile heartbeat",
    source_url: "https://example.com/music",
  };
  try {
    await service.execute("create_sequence", { name: "Portrait" });
    const before = state.snapshot();
    const request = {
      sessionId: state.sessionId,
      expectedRevision: state.revision,
      requestId: crypto.randomUUID(),
      operations: [
        { command: "set_asset_license", args: { assetId: "music", license } },
      ],
    };
    expect(await service.execute("apply_edits", request)).toMatchObject({
      ok: true,
      value: { project: { assets: [{ license }] } },
    });
    const saved = state.snapshot();
    expect(saved.undoSequenceId).toBeUndefined();
    expect(saved.project.timeline).toEqual(before.project.timeline);
    expect(saved.project.sequences).toEqual(before.project.sequences);
    expect(await service.execute("apply_edits", request)).toMatchObject({
      ok: true,
    });
    expect(state.snapshot()).toEqual(saved);
    await service.execute("undo");
    expect(state.project).toEqual(before.project);
    await service.execute("redo");
    const path = join(directory, "film.forgecut");
    await state.saveProject(path);
    const reopened = new AppState();
    await reopened.loadProject(path);
    expect(reopened.project).toEqual(state.project);
    expect(reopened.project.schema_version).toBe(7);
    expect(
      await service.execute("set_asset_license", {
        assetId: "music",
        license: null,
      }),
    ).toMatchObject({ ok: true });
    expect(state.project.assets[0]).not.toHaveProperty("license");
    await service.execute("undo");
    expect(state.project.assets[0]).toMatchObject({ license });
  } finally {
    await service.jobs.close();
    await service.closeGraphicsPreview();
    await rm(directory, { recursive: true, force: true });
  }
});
