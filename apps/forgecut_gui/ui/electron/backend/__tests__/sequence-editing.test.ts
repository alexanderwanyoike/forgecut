/** @vitest-environment node */
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

it("creates a named sequence with independent settings and one undo action", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  const before = state.snapshot();
  const created = await service.execute("create_sequence", {
    name: "Standalone clip",
    settings: { width: 1080, height: 1920, fps: 24 },
  });
  expect(created).toMatchObject({
    ok: true,
    value: {
      id: expect.stringMatching(/^[a-f\d-]{36}$/),
      name: "Standalone clip",
      settings: { width: 1080, height: 1920, fps: 24, sample_rate: 48000 },
      timeline: { tracks: [], markers: [] },
    },
  });
  expect(state.project.timeline).toEqual(before.project.timeline);
  expect(state.project.settings).toEqual(before.project.settings);
  expect(state.project.assets).toEqual(before.project.assets);
  expect(state.revision).toBe(before.revision + 1);
  expect(await service.execute("undo")).toMatchObject({ ok: true });
  expect(state.project).toEqual(before.project);
  expect(await service.execute("redo")).toMatchObject({ ok: true });
  expect(state.project.sequences).toHaveLength(1);
  await service.jobs.close();
  await service.closePreviews();
});
it("renames default and standalone sequences by stable identity in one guarded batch", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  const created = await service.execute("create_sequence", { name: "Clip" });
  if (!created.ok) throw new Error(created.error.message);
  const extra = state.project.sequences![0];
  const before = state.snapshot();
  const result = await service.execute("apply_edits", {
    sessionId: state.sessionId,
    expectedRevision: state.revision,
    requestId: crypto.randomUUID(),
    operations: [
      {
        command: "rename_sequence",
        args: {
          sequenceId: state.project.default_sequence!.id,
          name: "Trailer",
        },
      },
      {
        command: "rename_sequence",
        args: { sequenceId: extra.id, name: "Standalone" },
      },
    ],
  });
  expect(result).toMatchObject({ ok: true });
  expect(await service.execute("get_sequences")).toMatchObject({
    ok: true,
    value: [
      { id: state.project.default_sequence!.id, name: "Trailer" },
      { id: extra.id, name: "Standalone" },
    ],
  });
  expect(state.revision).toBe(before.revision + 1);
  expect(await service.execute("undo")).toMatchObject({ ok: true });
  expect(state.project).toEqual(before.project);
  await service.jobs.close();
  await service.closePreviews();
});
it("deletes an additional sequence reversibly while retaining the default sequence and shared assets", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  expect(
    await service.execute("create_sequence", { name: "Clip" }),
  ).toMatchObject({ ok: true });
  const extra = state.project.sequences![0];
  const before = state.snapshot();
  expect(
    await service.execute("delete_sequence", {
      sequenceId: state.project.default_sequence!.id,
    }),
  ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  expect(state.snapshot()).toEqual(before);
  expect(
    await service.execute("delete_sequence", { sequenceId: extra.id }),
  ).toMatchObject({ ok: true });
  expect(state.project.sequences).toEqual([]);
  expect(state.project.assets).toEqual(before.project.assets);
  expect(state.revision).toBe(before.revision + 1);
  expect(await service.execute("undo")).toMatchObject({ ok: true });
  expect(state.project).toEqual(before.project);
  await service.jobs.close();
  await service.closePreviews();
});
