/** @vitest-environment node */
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

it("edits video framing and stacking while preserving legacy placement and source audio", async () => {
  const state = new AppState();
  state.executeProjectChange((project) => {
    project.settings = { width: 640, height: 360, fps: 30, sample_rate: 48000 };
    project.assets.push({
      id: "source",
      name: "Source",
      kind: "Video",
      path: "/source.mp4",
      probe: null,
    });
    project.timeline.tracks.push(
      ...["main", "pip"].map((id) => ({
        id,
        kind: "Video" as const,
        items: [
          {
            VideoClip: {
              id: `${id}-clip`,
              track_id: id,
              asset_id: "source",
              timeline_start_us: 0,
              source_in_us: 0,
              source_out_us: 2000000,
              volume: 0.5,
            },
          },
        ],
      })),
    );
  });
  const service = new EditingService(state);
  expect(
    await service.execute("get_sequence_frame", { playheadUs: 0 }),
  ).toMatchObject({
    ok: true,
    value: {
      layers: [
        {
          placement: {
            x: 0,
            y: 0,
            width: 640,
            height: 360,
            fit: "contain",
            opacity: 1,
          },
        },
        {
          placement: {
            x: 460,
            y: 250,
            width: 160,
            height: 90,
            fit: "contain",
            opacity: 1,
          },
        },
      ],
    },
  });
  const transform = {
    x: 40,
    y: 30,
    width: 320,
    height: 180,
    fit: "cover",
    opacity: 0.4,
  };
  expect(
    await service.execute("update_item", {
      itemId: "pip-clip",
      patch: { kind: "VideoClip", changes: { transform, layer_order: -1 } },
    }),
  ).toMatchObject({ ok: true });
  expect(
    await service.execute("get_sequence_frame", { playheadUs: 0 }),
  ).toMatchObject({
    ok: true,
    value: {
      layers: [
        {
          item: { VideoClip: { id: "pip-clip", volume: 0.5 } },
          placement: transform,
        },
        { item: { VideoClip: { id: "main-clip" } } },
      ],
    },
  });
  await service.execute("undo");
  expect(
    await service.execute("get_sequence_frame", { playheadUs: 0 }),
  ).toMatchObject({
    ok: true,
    value: {
      layers: [
        { item: { VideoClip: { id: "main-clip" } } },
        { placement: { x: 460, y: 250, width: 160 } },
      ],
    },
  });
  const before = state.snapshot();
  expect(
    await service.execute("update_item", {
      itemId: "pip-clip",
      patch: {
        kind: "VideoClip",
        changes: { transform: { ...transform, width: 0 } },
      },
    }),
  ).toMatchObject({ ok: false });
  expect(state.snapshot()).toEqual(before);
});
