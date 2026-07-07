import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockInvoke = vi.hoisted(() => vi.fn());
vi.mock("../lib/bridge", () => ({
  invoke: mockInvoke,
  mediaUrl: (path: string) => `forgecut-media://${path}`,
}));

// Mock ResizeObserver
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", MockResizeObserver);

import Timeline from "../components/Timeline";
import {
  TIMELINE_ZOOM_MAX,
  TIMELINE_ZOOM_MIN,
  minimapViewport,
  timelinePointerUs,
  timelineRulerInterval,
  zoomInLevel,
  zoomOutLevel,
} from "../lib/timeline/geometry";

describe("Timeline controls", () => {
  const defaultProps = {
    playheadUs: 0,
    playing: false,
    onPlayheadChange: () => {},
    onPlayingChange: () => {},
    selectedClipId: null,
    onSelectedClipChange: () => {},
    projectVersion: 0,
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
              source_out_us: 12_000_000,
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
      if (cmd === "init_default_tracks") return { tracks: [], markers: [] };
      if (cmd === "get_snap_points") return [];
      if (cmd === "get_clip_thumbnails") return [];
      return null;
    });
  });

  it("renders zoom percentage label", () => {
    render(<Timeline {...defaultProps} />);
    // Default is 100px/s → "100%"
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("zoom slider clamps to bounds", () => {
    render(<Timeline {...defaultProps} />);
    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(Number(slider.min)).toBe(TIMELINE_ZOOM_MIN);
    expect(Number(slider.max)).toBe(TIMELINE_ZOOM_MAX);
  });

  it("zooms out gradually without losing the overview range", () => {
    render(<Timeline {...defaultProps} />);
    const zoomOut = screen.getByText("-");
    const slider = screen.getByRole("slider") as HTMLInputElement;

    fireEvent.click(zoomOut);

    expect(Number(slider.value)).toBe(90);
    expect(screen.getByText("90%")).toBeTruthy();

    for (let i = 0; i < 10; i += 1) {
      fireEvent.click(zoomOut);
    }

    expect(Number(slider.value)).toBeGreaterThan(TIMELINE_ZOOM_MIN);
    expect(Number(slider.value)).toBeLessThan(90);

    for (let i = 0; i < 40; i += 1) {
      fireEvent.click(zoomOut);
    }

    expect(Number(slider.value)).toBe(TIMELINE_ZOOM_MIN);
    expect(screen.getByText(`${TIMELINE_ZOOM_MIN}%`)).toBeTruthy();
  });

  it("uses multiplicative zoom control steps", () => {
    expect(zoomOutLevel(100)).toBe(90);
    expect(zoomOutLevel(10)).toBe(9);
    expect(zoomOutLevel(2)).toBe(TIMELINE_ZOOM_MIN);
    expect(zoomInLevel(100)).toBe(112);
    expect(zoomInLevel(499)).toBe(TIMELINE_ZOOM_MAX);
  });

  it("uses sparse ruler ticks at deep zoom-out levels", () => {
    expect(timelineRulerInterval(100)).toBe(1);
    expect(timelineRulerInterval(10)).toBe(10);
    expect(timelineRulerInterval(1)).toBe(60);
  });

  it("maps the minimap viewport to the scrollable width", () => {
    expect(minimapViewport(1_000, 500, 0)).toEqual({
      leftPercent: 0,
      widthPercent: 100,
    });

    expect(minimapViewport(1_000, 5_000, 2_000)).toEqual({
      leftPercent: 40,
      widthPercent: 20,
    });
  });

  it("calculates pointer seek time from live timeline scroll geometry", () => {
    expect(timelinePointerUs(508, 100, 0, 90)).toBe(4_000_000);
    expect(timelinePointerUs(188, 100, 500, 180)).toBe(3_000_000);
  });

  it("selects on a plain clip click without moving the playhead", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "init_default_tracks") return timelineWithVideo;
      if (cmd === "get_snap_points") return [];
      if (cmd === "get_clip_thumbnails") return [];
      return null;
    });
    const onPlayheadChange = vi.fn();
    const onSelectedClipChange = vi.fn();
    render(
      <Timeline
        {...defaultProps}
        onPlayheadChange={onPlayheadChange}
        onSelectedClipChange={onSelectedClipChange}
      />
    );
    const clip = await screen.findByText("Video");

    for (const zoom of [25, 90, 180]) {
      const slider = screen.getByRole("slider") as HTMLInputElement;
      fireEvent.change(slider, { target: { value: String(zoom) } });
      const clientX = 100 + 48 + 4 * zoom;

      fireEvent.mouseDown(clip, { clientX, clientY: 80 });
      fireEvent.mouseUp(window, { clientX, clientY: 80 });

      await waitFor(() => {
        expect(onSelectedClipChange).toHaveBeenLastCalledWith("clip-1");
      });
      expect(onPlayheadChange).not.toHaveBeenCalled();
    }
  });

  it("renders control group buttons", () => {
    render(<Timeline {...defaultProps} />);
    expect(screen.getByText("Playhead")).toBeTruthy();
    expect(screen.getByText("Fit")).toBeTruthy();
    expect(screen.getByText("Snap")).toBeTruthy();
    expect(screen.getByText("+ Text")).toBeTruthy();
    expect(screen.getByText("+ PiP")).toBeTruthy();
  });
});
