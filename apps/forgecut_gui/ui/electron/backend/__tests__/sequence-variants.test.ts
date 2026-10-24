/** @vitest-environment node */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { itemData } from "../../domain/timeline-item";
import type { EditOperation, ProjectSequence } from "../../shared/ipc-contract";

it("copies an independent portrait variant and explicitly syncs selected timing while retaining its shot and crop", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-variants-"));
  const state = new AppState();
  state.executeProjectChange((project) => {
    project.assets.push({
      id: "recording",
      name: "Recording",
      path: join(directory, "recording.mp4"),
      kind: "Video",
      probe: {
        duration_us: 10000000,
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
    expect(await service.execute("add_track", { kind: "Video" })).toMatchObject(
      { ok: true },
    );
    const videoTrackId = state.project.timeline.tracks[0].id;
    expect(
      await service.execute("add_clip_to_timeline", {
        assetId: "recording",
        trackId: videoTrackId,
        timelineStartUs: 0,
        sourceInUs: 1000000,
        sourceOutUs: 3000000,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await service.execute("add_text_overlay", {
        trackId: "text",
        timelineStartUs: 0,
        durationUs: 1000000,
        text: "Opening",
        fontSize: 48,
        color: "#ffffff",
        x: 10,
        y: 10,
      }),
    ).toMatchObject({ ok: true });
    const root = state.project.default_sequence!.id;
    const original = state.project.timeline;
    const sourceVideo = original.tracks[0].items[0];
    if (!("VideoClip" in sourceVideo)) throw new Error("Missing source video");
    const sourceItem = sourceVideo.VideoClip;
    const before = state.snapshot();
    const copied = await service.execute("create_sequence_variant", {
      sourceSequenceId: root,
      name: "Portrait",
      settings: { width: 360, height: 640 },
    });
    expect(copied).toMatchObject({
      ok: true,
      value: {
        name: "Portrait",
        settings: { width: 360, height: 640 },
        variant_source: { sequence_id: root },
      },
    });
    if (!copied.ok) throw new Error(copied.error.message);
    const variant = copied.value as ProjectSequence;
    const variantVideo = variant.timeline.tracks[0].items[0];
    if (!("VideoClip" in variantVideo))
      throw new Error("Missing variant video");
    const item = variantVideo.VideoClip;
    expect(item.id).not.toBe(sourceItem.id);
    expect(item.track_id).not.toBe(sourceItem.track_id);
    expect(item.asset_id).toBe(sourceItem.asset_id);
    expect(item.origin_item_id).toBe(sourceItem.id);
    expect(itemData(variant.timeline.tracks[1].items[0]).id).not.toBe(
      itemData(original.tracks[1].items[0]).id,
    );
    expect(state.project.timeline).toEqual(original);
    expect(state.getEditingContext().activeSequenceId).toBe(root);
    expect(state.revision).toBe(before.revision + 1);
    const crop = {
      x: -20,
      y: 0,
      width: 400,
      height: 640,
      fit: "cover" as const,
      opacity: 1,
    };
    const edit = async (
      sequenceId: string,
      requestId: string,
      operations: EditOperation[],
    ) =>
      service.execute("apply_edits", {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        sequenceId,
        requestId,
        operations,
      });
    expect(
      await edit(variant.id, "manual-portrait", [
        {
          command: "update_item",
          args: {
            itemId: item.id,
            patch: { kind: "VideoClip", changes: { transform: crop } },
          },
        },
        {
          command: "trim_clip",
          args: { itemId: item.id, trimType: "in", newUs: 2000000 },
        },
        {
          command: "trim_clip",
          args: { itemId: item.id, trimType: "out", newUs: 4000000 },
        },
        {
          command: "move_clip",
          args: { itemId: item.id, newStartUs: 3000000 },
        },
      ]),
    ).toMatchObject({ ok: true });
    const manual = structuredClone(state.project.sequences![0]);
    expect(
      await edit(root, "source-timing", [
        {
          command: "trim_clip",
          args: {
            itemId: sourceItem.id,
            trimType: "out",
            newUs: 2500000,
          },
        },
        {
          command: "move_clip",
          args: { itemId: sourceItem.id, newStartUs: 1000000 },
        },
      ]),
    ).toMatchObject({ ok: true });
    expect(state.project.sequences![0]).toEqual(manual);
    const sourceEdited = structuredClone(state.project.timeline);
    expect(
      await edit(variant.id, "explicit-sync", [
        { command: "sync_variant_timing", args: { itemIds: [item.id] } },
      ]),
    ).toMatchObject({ ok: true });
    const synced = state.project.sequences![0];
    expect(synced.timeline.tracks[0].items[0]).toMatchObject({
      VideoClip: {
        id: item.id,
        timeline_start_us: 1000000,
        source_in_us: 2000000,
        source_out_us: 3500000,
        transform: crop,
      },
    });
    expect(synced.timeline.tracks[1]).toEqual(manual.timeline.tracks[1]);
    expect(state.project.timeline).toEqual(sourceEdited);
    expect(
      await service.execute("apply_history", {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        requestId: "undo-sync",
        sequenceId: variant.id,
        direction: "undo",
      }),
    ).toMatchObject({ ok: true });
    expect(state.project.sequences![0]).toEqual(manual);
    expect(state.project.timeline).toEqual(sourceEdited);
    const path = join(directory, "variants.forgecut");
    await state.saveProject(path);
    const reopened = new AppState();
    await reopened.loadProject(path);
    expect(reopened.project).toEqual(state.project);
  } finally {
    await service.jobs.close();
    await service.closeGraphicsPreview();
    await rm(directory, { recursive: true, force: true });
  }
});
