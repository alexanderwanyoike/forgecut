import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Inspector from "../components/Inspector";
import { invokeGrouped } from "../lib/bridge";
import type { Project } from "../../electron/shared/ipc-contract";
vi.mock("../lib/bridge", () => ({
  invoke: vi.fn(),
  invokeGrouped: vi.fn().mockResolvedValue(undefined),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("edits the resolved video frame, fit, opacity and layer order through shared commands", () => {
  const project: Project = {
    id: "project",
    name: "Picture",
    settings: { width: 640, height: 360, fps: 30, sample_rate: 48000 },
    assets: [],
    timeline: {
      markers: [],
      tracks: [
        {
          id: "video",
          kind: "Video",
          items: [
            {
              VideoClip: {
                id: "clip",
                track_id: "video",
                asset_id: "source",
                timeline_start_us: 0,
                source_in_us: 0,
                source_out_us: 2000000,
              },
            },
          ],
        },
      ],
    },
  };
  const { rerender } = render(
    <Inspector project={project} selectedClipId="clip" />,
  );
  fireEvent.change(screen.getByLabelText("X"), { target: { value: "100" } });
  expect(invokeGrouped).toHaveBeenLastCalledWith(
    expect.any(String),
    "update_item",
    {
      itemId: "clip",
      patch: {
        kind: "VideoClip",
        changes: {
          transform: {
            x: 100,
            y: 0,
            width: 640,
            height: 360,
            opacity: 1,
            fit: "contain",
          },
        },
      },
    },
  );
  fireEvent.change(screen.getByLabelText("Fit"), {
    target: { value: "cover" },
  });
  expect(invokeGrouped).toHaveBeenLastCalledWith(
    expect.any(String),
    "update_item",
    {
      itemId: "clip",
      patch: {
        kind: "VideoClip",
        changes: { transform: expect.objectContaining({ fit: "cover" }) },
      },
    },
  );
  fireEvent.change(screen.getByLabelText("Opacity"), {
    target: { value: "0.5" },
  });
  expect(invokeGrouped).toHaveBeenLastCalledWith(
    expect.any(String),
    "update_item",
    {
      itemId: "clip",
      patch: {
        kind: "VideoClip",
        changes: { transform: expect.objectContaining({ opacity: 0.5 }) },
      },
    },
  );
  fireEvent.change(screen.getByLabelText("Layer order"), {
    target: { value: "2" },
  });
  expect(invokeGrouped).toHaveBeenLastCalledWith(
    expect.any(String),
    "update_item",
    {
      itemId: "clip",
      patch: { kind: "VideoClip", changes: { layer_order: 2 } },
    },
  );
  const next = structuredClone(project);
  const item = next.timeline.tracks[0].items[0];
  if (!("VideoClip" in item)) throw new Error("Invalid picture fixture");
  item.VideoClip.transform = {
    x: 10.4,
    y: 20.6,
    width: 100.4,
    height: 50.4,
    fit: "cover",
    opacity: 1,
  };
  rerender(
    <Inspector project={next} selectedClipId="clip" projectVersion={1} />,
  );
  fireEvent.change(screen.getByLabelText("Opacity"), {
    target: { value: "0.5" },
  });
  expect(invokeGrouped).toHaveBeenLastCalledWith(
    expect.any(String),
    "update_item",
    {
      itemId: "clip",
      patch: {
        kind: "VideoClip",
        changes: { transform: { ...item.VideoClip.transform, opacity: 0.5 } },
      },
    },
  );
});
