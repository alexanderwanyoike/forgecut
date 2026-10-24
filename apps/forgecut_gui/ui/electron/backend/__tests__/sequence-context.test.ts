/** @vitest-environment node */
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

it("switches sequence context without creative edits and restores each playhead", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  expect(
    await service.execute("create_sequence", { name: "Clip" }),
  ).toMatchObject({ ok: true });
  const root = state.project.default_sequence!.id;
  const clip = state.project.sequences![0].id;
  await service.execute("set_editing_context", {
    sessionId: state.sessionId,
    selectedItemIds: [],
    playheadUs: 1000000,
    sequenceId: root,
  });
  const before = state.snapshot();
  expect(
    await service.execute("select_sequence", {
      sessionId: state.sessionId,
      sequenceId: clip,
    }),
  ).toMatchObject({
    ok: true,
    value: {
      activeSequenceId: clip,
      selectedItemIds: [],
      selectedLayerIds: [],
      playheadUs: 0,
    },
  });
  expect(state.revision).toBe(before.revision);
  expect(state.project).toEqual(before.project);
  await service.execute("set_editing_context", {
    sessionId: state.sessionId,
    selectedItemIds: [],
    playheadUs: 500000,
    sequenceId: clip,
  });
  expect(
    await service.execute("select_sequence", {
      sessionId: state.sessionId,
      sequenceId: root,
    }),
  ).toMatchObject({
    ok: true,
    value: { activeSequenceId: root, playheadUs: 1000000 },
  });
  expect(
    await service.execute("select_sequence", {
      sessionId: state.sessionId,
      sequenceId: clip,
    }),
  ).toMatchObject({
    ok: true,
    value: { activeSequenceId: clip, playheadUs: 500000 },
  });
  expect(
    await service.execute("select_sequence", {
      sessionId: crypto.randomUUID(),
      sequenceId: root,
    }),
  ).toMatchObject({ ok: false, error: { code: "PROJECT_CHANGED" } });
  expect(state.revision).toBe(before.revision);
  await service.jobs.close();
  await service.closeGraphicsPreview();
});
it("edits an explicit sequence without changing the human active sequence", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  expect(
    await service.execute("create_sequence", {
      name: "Portrait clip",
      settings: { width: 1080, height: 1920 },
    }),
  ).toMatchObject({ ok: true });
  const root = state.project.default_sequence!.id;
  const clip = state.project.sequences![0].id;
  await service.execute("select_sequence", {
    sessionId: state.sessionId,
    sequenceId: clip,
  });
  await service.execute("select_sequence", {
    sessionId: state.sessionId,
    sequenceId: root,
  });
  const revision = state.revision;
  const operation = {
    command: "add_text_overlay",
    args: {
      trackId: "titles",
      timelineStartUs: 0,
      durationUs: 1000000,
      text: "Keep my wording",
      fontSize: 48,
      color: "#ffffff",
      x: 20,
      y: 50,
    },
  };
  const result = await service.execute("apply_edits", {
    sessionId: state.sessionId,
    expectedRevision: revision,
    requestId: crypto.randomUUID(),
    sequenceId: clip,
    operations: [operation],
  });
  expect(result).toMatchObject({ ok: true });
  expect(state.project.timeline.tracks).toEqual([]);
  expect(state.project.sequences![0].timeline.tracks[0].items[0]).toMatchObject(
    { TextOverlay: { text: "Keep my wording", x: 20, y: 50 } },
  );
  expect(state.snapshot().activeSequenceId).toBe(root);
  expect(state.revision).toBe(revision + 1);
  expect(
    await service.execute("get_sequence_timeline", { sequenceId: clip }),
  ).toMatchObject({ ok: true, value: state.project.sequences![0].timeline });
  const before = state.snapshot();
  expect(
    await service.execute("apply_edits", {
      sessionId: state.sessionId,
      expectedRevision: state.revision,
      requestId: crypto.randomUUID(),
      operations: [operation],
    }),
  ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  expect(state.snapshot()).toEqual(before);
  const item = state.project.sequences![0].timeline.tracks[0].items[0];
  if (!("TextOverlay" in item)) throw new Error("Missing title");
  await service.execute("select_sequence", {
    sessionId: state.sessionId,
    sequenceId: clip,
  });
  await service.execute("set_editing_context", {
    sessionId: state.sessionId,
    selectedItemIds: [item.TextOverlay.id],
    playheadUs: 250000,
    sequenceId: clip,
  });
  await service.execute("select_sequence", {
    sessionId: state.sessionId,
    sequenceId: root,
  });
  expect(await service.execute("get_editing_context")).toMatchObject({
    ok: true,
    value: { selectedItemIds: [] },
  });
  expect(
    await service.execute("select_sequence", {
      sessionId: state.sessionId,
      sequenceId: clip,
    }),
  ).toMatchObject({
    ok: true,
    value: { selectedItemIds: [item.TextOverlay.id], playheadUs: 250000 },
  });
  await service.jobs.close();
  await service.closeGraphicsPreview();
});
it("creates and resolves graphics using the explicitly targeted sequence settings", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  expect(
    await service.execute("create_sequence", {
      name: "Portrait",
      settings: { width: 360, height: 640, fps: 10 },
    }),
  ).toMatchObject({ ok: true });
  const clip = state.project.sequences![0].id;
  expect(
    await service.execute("apply_edits", {
      sessionId: state.sessionId,
      expectedRevision: state.revision,
      requestId: crypto.randomUUID(),
      sequenceId: clip,
      operations: [
        {
          command: "add_graphic_item",
          args: {
            templateId: "title-card",
            trackId: "graphics",
            timelineStartUs: 0,
            durationUs: 1000000,
            props: { title: "Portrait words", entrance_frames: 0 },
          },
        },
      ],
    }),
  ).toMatchObject({ ok: true });
  expect(state.project.timeline.tracks).toEqual([]);
  const item = state.project.sequences![0].timeline.tracks[0].items[0];
  if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
  expect(item.RemotionGraphic.props.title_width).toBeLessThanOrEqual(360);
  expect(
    await service.execute(
      "get_sequence_frame",
      { playheadUs: 0 },
      { sessionId: state.sessionId, sequenceId: clip },
    ),
  ).toMatchObject({
    ok: true,
    value: {
      settings: { width: 360, height: 640, fps: 10 },
      frameCount: 10,
      layers: [{ item: { RemotionGraphic: { id: item.RemotionGraphic.id } } }],
    },
  });
  expect(
    await service.execute("get_graphic_draft", {
      itemId: item.RemotionGraphic.id,
    }),
  ).toMatchObject({
    ok: true,
    value: {
      baseVersion: item.RemotionGraphic.component_version,
      component: { id: item.RemotionGraphic.component_id },
    },
  });
  await service.jobs.close();
  await service.closeGraphicsPreview();
});

it("rejects stale context writes after the human selects a different sequence", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  await service.execute("create_sequence", { name: "Clip" });
  const root = state.project.default_sequence!.id;
  const clip = state.project.sequences![0].id;
  await service.execute("select_sequence", {
    sessionId: state.sessionId,
    sequenceId: clip,
  });
  expect(
    await service.execute(
      "set_editing_context",
      { sessionId: state.sessionId, selectedItemIds: [], playheadUs: 100 },
      { sequenceId: clip },
    ),
  ).toMatchObject({ ok: true });
  const before = state.getEditingContext();
  expect(
    await service.execute(
      "set_editing_context",
      { sessionId: state.sessionId, selectedItemIds: [], playheadUs: 900000 },
      { sequenceId: root },
    ),
  ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  expect(state.getEditingContext()).toEqual(before);
  expect(
    await service.execute("set_editing_context", {
      sessionId: state.sessionId,
      selectedItemIds: [],
      playheadUs: 900000,
    }),
  ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  expect(state.getEditingContext()).toEqual(before);
  await service.jobs.close();
  await service.closeGraphicsPreview();
});
it("targets chronological undo explicitly and never groups edits across sequences", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  await service.execute("create_sequence", { name: "Clip" });
  const root = state.project.default_sequence!.id;
  const clip = state.project.sequences![0].id;
  const add = async (sequenceId: string, trackId: string, text: string) =>
    service.execute("apply_edits", {
      sessionId: state.sessionId,
      expectedRevision: state.revision,
      requestId: crypto.randomUUID(),
      sequenceId,
      editGroup: "typing",
      operations: [
        {
          command: "add_text_overlay",
          args: {
            trackId,
            timelineStartUs: 0,
            durationUs: 1000000,
            text,
            fontSize: 48,
            color: "#ffffff",
            x: 10,
            y: 20,
          },
        },
      ],
    });
  expect(await add(root, "root-titles", "Root text")).toMatchObject({
    ok: true,
  });
  expect(await add(clip, "clip-titles", "Clip text")).toMatchObject({
    ok: true,
  });
  const before = state.snapshot();
  expect(
    await service.execute("undo", undefined, { sequenceId: root }),
  ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  expect(state.snapshot()).toEqual(before);
  expect(before.canUndo).toBe(false);
  expect(before.undoSequenceId).toBe(clip);
  const history = async (sequenceId: string, direction: "undo" | "redo") =>
    service.execute("apply_history", {
      sessionId: state.sessionId,
      expectedRevision: state.revision,
      requestId: crypto.randomUUID(),
      sequenceId,
      direction,
    });
  expect(await history(clip, "undo")).toMatchObject({ ok: true });
  expect(state.project.timeline.tracks[0].items).toHaveLength(1);
  expect(state.project.sequences![0].timeline.tracks).toEqual([]);
  expect(state.snapshot().activeSequenceId).toBe(root);
  expect(await history(clip, "redo")).toMatchObject({ ok: true });
  expect(state.project.sequences![0].timeline.tracks[0].items).toHaveLength(1);
  expect(await history(clip, "undo")).toMatchObject({ ok: true });
  expect(await history(root, "undo")).toMatchObject({ ok: true });
  expect(state.project.timeline.tracks).toEqual([]);
  expect(state.project.sequences).toHaveLength(1);
  await service.jobs.close();
  await service.closeGraphicsPreview();
});
it("rolls back a batch that deletes its target before a later timeline operation", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  await service.execute("create_sequence", { name: "Clip" });
  const clip = state.project.sequences![0].id;
  const before = state.snapshot();
  const result = await service.execute("apply_edits", {
    sessionId: state.sessionId,
    expectedRevision: state.revision,
    requestId: crypto.randomUUID(),
    sequenceId: clip,
    operations: [
      { command: "delete_sequence", args: { sequenceId: clip } },
      {
        command: "add_text_overlay",
        args: {
          trackId: "titles",
          timelineStartUs: 0,
          durationUs: 1000000,
          text: "Never retarget this",
          fontSize: 48,
          color: "#ffffff",
          x: 10,
          y: 20,
        },
      },
    ],
  });
  expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  expect(state.snapshot()).toEqual(before);
  await service.jobs.close();
  await service.closeGraphicsPreview();
});
