import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Mock @tauri-apps/api/core
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

// Mock ResizeObserver
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", MockResizeObserver);

import Timeline from "../components/Timeline";

describe("Timeline thumbnails", () => {
  const defaultProps = {
    playheadUs: 0,
    playing: false,
    onPlayheadChange: () => {},
    onPlayingChange: () => {},
    selectedClipId: null,
    onSelectedClipChange: () => {},
  };

  const timelineWithVideo = {
    tracks: [
      {
        id: "track-1",
        kind: "Video",
        items: [
          {
            VideoClip: {
              id: "clip-1",
              asset_id: "asset-1",
              track_id: "track-1",
              timeline_start_us: 0,
              source_in_us: 0,
              source_out_us: 3_000_000,
            },
          },
        ],
      },
    ],
    markers: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "init_default_tracks") return timelineWithVideo;
      if (cmd === "get_clip_thumbnails") {
        return [
          { time_seconds: 0, data_uri: "data:image/jpeg;base64,/9j/4AAQ" },
          { time_seconds: 2, data_uri: "data:image/jpeg;base64,/9j/4BBQ" },
        ];
      }
      if (cmd === "get_snap_points") return [];
      if (cmd === "get_waveform") throw new Error("not audio");
      return null;
    });
  });

  it("fetches thumbnails for video clips", async () => {
    render(<Timeline {...defaultProps} />);
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c: any) => c[0] === "get_clip_thumbnails"
      );
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][1]).toEqual({ assetId: "asset-1" });
    });
  });

  it("renders thumbnail images in clip", async () => {
    render(<Timeline {...defaultProps} />);
    await waitFor(() => {
      const imgs = document.querySelectorAll(".clip-thumbnail");
      expect(imgs.length).toBeGreaterThan(0);
    });
  });

  it("caches thumbnails and does not re-fetch", async () => {
    render(<Timeline {...defaultProps} />);
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c: any) => c[0] === "get_clip_thumbnails"
      );
      expect(calls.length).toBe(1);
    });
  });
});
