/** @vitest-environment node */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

it("keeps an explicit sequence end in history and saved projects without trimming its items", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-sequence-end-"));
  try {
    const state = new AppState();
    const service = new EditingService(state);
    await service.execute("update_project", { settings: { fps: 10 } });
    await service.execute("add_text_overlay", {
      trackId: "title",
      timelineStartUs: 0,
      durationUs: 2000000,
      text: "End",
      fontSize: 24,
      color: "#ffffff",
      x: 0,
      y: 0,
    });
    expect(
      await service.execute("set_sequence_end", { endUs: 1000000 }),
    ).toMatchObject({ ok: true });
    expect(
      await service.execute("get_sequence_frame", { playheadUs: 1500000 }),
    ).toMatchObject({
      ok: true,
      value: { durationUs: 1000000, frameCount: 10, layers: [] },
    });
    expect(state.project.timeline.tracks[0].items[0]).toMatchObject({
      TextOverlay: { duration_us: 2000000 },
    });
    const path = join(directory, "saved.forgecut");
    await state.saveProject(path);
    await service.execute("undo");
    expect(
      await service.execute("get_sequence_frame", { playheadUs: 1500000 }),
    ).toMatchObject({
      ok: true,
      value: {
        durationUs: 2000000,
        layers: [{ item: { TextOverlay: { text: "End" } } }],
      },
    });
    await state.loadProject(path);
    expect(
      await service.execute("get_sequence_frame", { playheadUs: 1500000 }),
    ).toMatchObject({ ok: true, value: { durationUs: 1000000, layers: [] } });
    expect(
      await service.execute("set_sequence_end", { endUs: 4000000 }),
    ).toMatchObject({ ok: true });
    expect(
      await service.execute("get_sequence_frame", { playheadUs: 3000000 }),
    ).toMatchObject({
      ok: true,
      value: { durationUs: 4000000, frameCount: 40, layers: [] },
    });
    await service.execute("set_sequence_end", { endUs: null });
    expect(
      await service.execute("get_sequence_frame", { playheadUs: 0 }),
    ).toMatchObject({ ok: true, value: { durationUs: 2000000 } });
    const before = state.snapshot();
    expect(
      await service.execute("set_sequence_end", { endUs: 0 }),
    ).toMatchObject({ ok: false });
    expect(state.snapshot()).toEqual(before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
