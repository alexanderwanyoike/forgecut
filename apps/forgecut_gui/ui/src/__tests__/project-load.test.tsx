import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

// Mock @tauri-apps/api/core
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

// Mock ResizeObserver
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", MockResizeObserver);

import AssetBin from "../components/AssetBin";
import Timeline from "../components/Timeline";

const emptyTimeline = { tracks: [], markers: [] };

const timelineWithClips = {
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

const mockAssets = [
  {
    id: "asset-1",
    name: "clip.mp4",
    path: "/tmp/clip.mp4",
    kind: "Video",
    probe: { duration_us: 10_000_000, width: 1920, height: 1080, fps: 30, codec: "h264" },
  },
];

const timelineProps = {
  playheadUs: 0,
  playing: false,
  onPlayheadChange: () => {},
  onPlayingChange: () => {},
  selectedClipId: null,
  onSelectedClipChange: () => {},
};

describe("AssetBin projectVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_assets") return mockAssets;
      return null;
    });
  });

  it("fetches assets on mount", async () => {
    render(<AssetBin projectVersion={0} />);
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter((c: any) => c[0] === "get_assets");
      expect(calls.length).toBe(1);
    });
  });

  it("refetches assets when projectVersion changes", async () => {
    const { rerender } = render(<AssetBin projectVersion={0} />);
    await waitFor(() => {
      expect(mockInvoke.mock.calls.some((c: any) => c[0] === "get_assets")).toBe(true);
    });

    await act(async () => {
      rerender(<AssetBin projectVersion={1} />);
    });

    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter((c: any) => c[0] === "get_assets");
      expect(calls.length).toBe(2);
    });
  });

  it("displays assets from backend after fetch", async () => {
    render(<AssetBin projectVersion={0} />);
    await waitFor(() => {
      expect(screen.getByText("clip.mp4")).toBeTruthy();
    });
  });

  it("handles null response from get_assets gracefully", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_assets") return null;
      return null;
    });
    render(<AssetBin projectVersion={0} />);
    // Should not crash — asset list simply empty
    await waitFor(() => {
      expect(document.querySelector(".asset-list")?.children.length).toBe(0);
    });
  });
});

describe("Timeline projectVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation(async (cmd: string) => {
      // Return a fresh object each time so React detects a state change
      if (cmd === "init_default_tracks") return JSON.parse(JSON.stringify(timelineWithClips));
      if (cmd === "get_clip_thumbnails") {
        return [{ time_seconds: 0, data_uri: "data:image/jpeg;base64,/9j/4AAQ" }];
      }
      if (cmd === "get_snap_points") return [];
      if (cmd === "get_waveform") throw new Error("not audio");
      return null;
    });
  });

  it("re-fetches tracks when projectVersion changes", async () => {
    const { rerender } = render(
      <Timeline {...timelineProps} projectVersion={0} />
    );
    await waitFor(() => {
      expect(mockInvoke.mock.calls.some((c: any) => c[0] === "init_default_tracks")).toBe(true);
    });

    await act(async () => {
      rerender(<Timeline {...timelineProps} projectVersion={1} />);
    });

    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter((c: any) => c[0] === "init_default_tracks");
      expect(calls.length).toBe(2);
    });
  });

  it("clears thumbnail cache on projectVersion change and re-fetches", async () => {
    const { rerender } = render(
      <Timeline {...timelineProps} projectVersion={0} />
    );

    // Wait for initial thumbnail fetch
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter((c: any) => c[0] === "get_clip_thumbnails");
      expect(calls.length).toBeGreaterThan(0);
    });

    const callsBefore = mockInvoke.mock.calls.filter(
      (c: any) => c[0] === "get_clip_thumbnails"
    ).length;

    // Bump version — should clear cache and re-fetch
    await act(async () => {
      rerender(<Timeline {...timelineProps} projectVersion={1} />);
    });

    await waitFor(() => {
      const callsAfter = mockInvoke.mock.calls.filter(
        (c: any) => c[0] === "get_clip_thumbnails"
      ).length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });
  });

  it("does not clear caches on initial mount (version 0)", async () => {
    // The cache-clear effect guards with `if (props.projectVersion === 0) return`
    // So on mount, init_default_tracks runs but thumbnails aren't wiped
    render(<Timeline {...timelineProps} projectVersion={0} />);

    await waitFor(() => {
      const initCalls = mockInvoke.mock.calls.filter(
        (c: any) => c[0] === "init_default_tracks"
      );
      expect(initCalls.length).toBe(1);
    });

    // Thumbnails should have been fetched (not cleared before fetch)
    await waitFor(() => {
      const thumbCalls = mockInvoke.mock.calls.filter(
        (c: any) => c[0] === "get_clip_thumbnails"
      );
      expect(thumbCalls.length).toBe(1);
    });
  });
});
