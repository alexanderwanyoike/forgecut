/** @vitest-environment node */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

it("retains source ranges and editorial notes independently of sequences through edits, undo and reopen", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "forgecut-source-selections-"),
  );
  const state = new AppState();
  state.executeProjectChange((project) => {
    project.assets.push({
      id: "recording",
      name: "Session",
      path: join(directory, "recording.mp4"),
      kind: "Video",
      probe: {
        duration_us: 10_000_000,
        width: 1920,
        height: 1080,
        fps: 30,
        codec: "h264",
        audio_channels: 2,
        audio_sample_rate: 48000,
      },
    });
  });
  const service = new EditingService(state);
  try {
    await service.execute("create_sequence", { name: "Portrait" });
    const before = state.snapshot();
    const created = await service.execute("save_source_selection", {
      assetId: "recording",
      name: "Quiet opening",
      sourceInUs: 1_000_000,
      sourceOutUs: 3_000_000,
      notes: "Keep the engine sound",
      rationale: "Introduces the setting before the first title",
    });
    expect(created).toMatchObject({
      ok: true,
      value: {
        id: expect.stringMatching(/^[a-f\d-]{36}$/),
        asset_id: "recording",
        source_in_us: 1_000_000,
        source_out_us: 3_000_000,
        name: "Quiet opening",
        notes: "Keep the engine sound",
        rationale: "Introduces the setting before the first title",
      },
    });
    if (!created.ok) throw new Error(created.error.message);
    const selection = state.project.source_selections![0];
    expect(state.project.timeline).toEqual(before.project.timeline);
    expect(state.project.sequences).toEqual(before.project.sequences);
    expect(state.getEditingContext().activeSequenceId).toBe(
      before.activeSequenceId,
    );
    expect(state.revision).toBe(before.revision + 1);
    const edited = await service.execute("save_source_selection", {
      selectionId: selection.id,
      assetId: "recording",
      name: "Opening",
      sourceInUs: 1_500_000,
      sourceOutUs: 3_000_000,
      notes: "Trimmed manually",
      rationale: selection.rationale,
    });
    expect(edited).toMatchObject({ ok: true });
    expect(state.project.source_selections).toHaveLength(1);
    expect(state.project.source_selections![0]).toMatchObject({
      id: selection.id,
      source_in_us: 1_500_000,
      notes: "Trimmed manually",
    });
    await service.execute("undo");
    expect(state.project.source_selections![0]).toEqual(selection);
    await service.execute("redo");
    const path = join(directory, "picks.forgecut");
    await state.saveProject(path);
    const reopened = new AppState();
    await reopened.loadProject(path);
    expect(reopened.project).toEqual(state.project);
    const saved = state.snapshot();
    expect(
      await service.execute("save_source_selection", {
        assetId: "recording",
        name: "Invalid",
        sourceInUs: 9_000_000,
        sourceOutUs: 11_000_000,
        notes: "",
        rationale: "",
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(state.snapshot()).toEqual(saved);
    expect(
      await service.execute("delete_source_selection", {
        selectionId: selection.id,
      }),
    ).toMatchObject({ ok: true });
    expect(state.project.source_selections).toEqual([]);
    await service.execute("undo");
    expect(state.project).toEqual(saved.project);
  } finally {
    await service.jobs.close();
    await service.closeGraphicsPreview();
    await rm(directory, { recursive: true, force: true });
  }
});
