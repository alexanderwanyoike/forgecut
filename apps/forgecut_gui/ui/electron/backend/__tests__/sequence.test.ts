/** @vitest-environment node */
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

it("resolves gaps and half-open cuts on the project frame grid without accumulating source drift", async () => {
  const state = new AppState();
  state.executeProjectChange((project) => {
    project.settings.fps = 30;
    project.assets.push({
      id: "video",
      name: "Source",
      path: "/source.mkv",
      kind: "Video",
      probe: {
        duration_us: 10000000,
        width: 640,
        height: 360,
        fps: 60,
        codec: "h264",
        audio_channels: 0,
        audio_sample_rate: 0,
      },
    });
    project.timeline.tracks.push({
      id: "picture",
      kind: "Video",
      items: [
        {
          VideoClip: {
            id: "first",
            asset_id: "video",
            track_id: "picture",
            timeline_start_us: 1000000,
            source_in_us: 2000000,
            source_out_us: 3000000,
          },
        },
        {
          VideoClip: {
            id: "second",
            asset_id: "video",
            track_id: "picture",
            timeline_start_us: 2000000,
            source_in_us: 4000000,
            source_out_us: 5000000,
          },
        },
      ],
    });
  });
  const editing = new EditingService(state);
  expect(
    await editing.execute("get_sequence_frame", { playheadUs: 500000 }),
  ).toMatchObject({
    ok: true,
    value: { frame: 15, frameCount: 90, durationUs: 3000000, layers: [] },
  });
  expect(
    await editing.execute("get_sequence_frame", { playheadUs: 1000000 }),
  ).toMatchObject({
    ok: true,
    value: {
      frame: 30,
      layers: [{ sourceTimeUs: 2000000, item: { VideoClip: { id: "first" } } }],
    },
  });
  expect(
    await editing.execute("get_sequence_frame", { playheadUs: 2000000 }),
  ).toMatchObject({
    ok: true,
    value: {
      frame: 60,
      layers: [
        { sourceTimeUs: 4000000, item: { VideoClip: { id: "second" } } },
      ],
    },
  });
  expect(
    await editing.execute("get_sequence_frame", { playheadUs: 2500000 }),
  ).toMatchObject({
    ok: true,
    value: { frame: 75, layers: [{ sourceTimeUs: 4500000 }] },
  });
  expect(
    await editing.execute("get_sequence_frame", { playheadUs: 3000000 }),
  ).toMatchObject({ ok: true, value: { layers: [] } });
});

it("round trips fractional frame rates at microsecond boundaries without adding a frame", async () => {
  const state = new AppState();
  state.executeProjectChange((project) => {
    project.settings.fps = 24000 / 1001;
    project.timeline.tracks.push({
      id: "titles",
      kind: "OverlayText",
      items: [
        {
          TextOverlay: {
            id: "card",
            track_id: "titles",
            timeline_start_us: 41708,
            duration_us: 125125,
            text: "Card",
            font_size: 24,
            color: "#ffffff",
            x: 0,
            y: 0,
          },
        },
      ],
    });
  });
  const editing = new EditingService(state);
  expect(
    await editing.execute("get_sequence_frame", { playheadUs: 41708 }),
  ).toMatchObject({
    ok: true,
    value: {
      frame: 1,
      frameCount: 4,
      layers: [{ item: { TextOverlay: { id: "card" } } }],
    },
  });
  expect(
    await editing.execute("get_sequence_frame", { playheadUs: 166833 }),
  ).toMatchObject({ ok: true, value: { frame: 4, frameCount: 4, layers: [] } });
});
