/** @vitest-environment node */
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

it("edits source gain, mute and fades in shared history and resolves their current envelope", async () => {
  const state = new AppState();
  state.executeProjectChange((project) => {
    project.settings.fps = 20;
    project.assets.push({
      id: "source",
      name: "Source",
      path: "/source.mp4",
      kind: "Video",
      probe: {
        duration_us: 2000000,
        width: 64,
        height: 36,
        fps: 20,
        codec: "h264",
        audio_channels: 2,
        audio_sample_rate: 48000,
      },
    });
    project.timeline.tracks.push({
      id: "picture",
      kind: "Video",
      items: [
        {
          VideoClip: {
            id: "clip",
            asset_id: "source",
            track_id: "picture",
            timeline_start_us: 0,
            source_in_us: 0,
            source_out_us: 2000000,
          },
        },
      ],
    });
  });
  const service = new EditingService(state);
  const request = {
    sessionId: state.sessionId,
    expectedRevision: state.revision,
    requestId: "audio-settings",
    operations: [
      {
        command: "update_item",
        args: {
          itemId: "clip",
          patch: {
            kind: "VideoClip",
            changes: {
              volume: 2,
              muted: false,
              fade_in_us: 500000,
              fade_out_us: 1000000,
            },
          },
        },
      },
    ],
  };
  expect(await service.execute("apply_edits", request)).toMatchObject({
    ok: true,
  });
  expect(
    await service.execute("get_sequence_frame", { playheadUs: 250000 }),
  ).toMatchObject({
    ok: true,
    value: { layers: [{ audioGain: 1 }] },
  });
  expect(
    await service.execute("get_sequence_frame", { playheadUs: 1500000 }),
  ).toMatchObject({
    ok: true,
    value: { layers: [{ audioGain: 1 }] },
  });
  expect(
    await service.execute("update_item", {
      itemId: "clip",
      patch: { kind: "VideoClip", changes: { muted: true } },
    }),
  ).toMatchObject({ ok: true });
  expect(
    await service.execute("get_sequence_frame", { playheadUs: 1000000 }),
  ).toMatchObject({
    ok: true,
    value: { layers: [{ audioGain: 0 }] },
  });
  await service.execute("undo");
  expect(
    await service.execute("get_sequence_frame", { playheadUs: 1000000 }),
  ).toMatchObject({
    ok: true,
    value: { layers: [{ audioGain: 2 }] },
  });
  const before = state.snapshot();
  expect(
    await service.execute("update_item", {
      itemId: "clip",
      patch: { kind: "VideoClip", changes: { fade_in_us: -1 } },
    }),
  ).toMatchObject({ ok: false });
  expect(state.snapshot()).toEqual(before);
});
