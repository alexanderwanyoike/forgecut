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
  await service.closeGraphicsPreview();
});
