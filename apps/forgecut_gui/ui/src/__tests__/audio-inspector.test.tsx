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
it("exposes source gain, mute and fade controls as typed shared edits", () => {
  const project: Project = {
    id: "project",
    name: "Source",
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
  render(<Inspector project={project} selectedClipId="clip" />);
  fireEvent.change(screen.getByLabelText("Volume"), { target: { value: "2" } });
  expect(invokeGrouped).toHaveBeenLastCalledWith(
    expect.any(String),
    "update_item",
    { itemId: "clip", patch: { kind: "VideoClip", changes: { volume: 2 } } },
  );
  fireEvent.click(screen.getByLabelText("Mute"));
  expect(invokeGrouped).toHaveBeenLastCalledWith(
    expect.any(String),
    "update_item",
    { itemId: "clip", patch: { kind: "VideoClip", changes: { muted: true } } },
  );
  fireEvent.change(screen.getByLabelText("Fade in (s)"), {
    target: { value: "0.5" },
  });
  expect(invokeGrouped).toHaveBeenLastCalledWith(
    expect.any(String),
    "update_item",
    {
      itemId: "clip",
      patch: { kind: "VideoClip", changes: { fade_in_us: 500000 } },
    },
  );
  fireEvent.change(screen.getByLabelText("Fade out (s)"), {
    target: { value: "1" },
  });
  expect(invokeGrouped).toHaveBeenLastCalledWith(
    expect.any(String),
    "update_item",
    {
      itemId: "clip",
      patch: { kind: "VideoClip", changes: { fade_out_us: 1000000 } },
    },
  );
});
