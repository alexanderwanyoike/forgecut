import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Preview from "../components/Preview";

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

describe("Preview component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_clip_at_playhead") return null;
      if (cmd === "get_overlays_at_time") return [];
      return null;
    });
  });

  it("renders play button", () => {
    render(
      <Preview
        playheadUs={0}
        playing={false}
        onPlayingChange={() => {}}
        onPlayheadChange={() => {}}
      />
    );
    const btn = screen.getByRole("button");
    expect(btn.textContent).toContain("\u25B6");
  });

  it("shows stop icon when playing", () => {
    render(
      <Preview
        playheadUs={0}
        playing={true}
        onPlayingChange={() => {}}
        onPlayheadChange={() => {}}
      />
    );
    const btn = screen.getByRole("button");
    expect(btn.textContent).toContain("\u23F9");
  });

  it("formats playhead time correctly", () => {
    render(
      <Preview
        playheadUs={65_500_000}
        playing={false}
        onPlayingChange={() => {}}
        onPlayheadChange={() => {}}
      />
    );
    expect(screen.getByText("00:01:05.500")).toBeTruthy();
  });

  it("calls get_clip_at_playhead when playheadUs changes", async () => {
    const { unmount } = render(
      <Preview
        playheadUs={1_000_000}
        playing={false}
        onPlayingChange={() => {}}
        onPlayheadChange={() => {}}
      />
    );

    await new Promise((r) => setTimeout(r, 50));

    const calls = mockInvoke.mock.calls.filter(
      (c) => c[0] === "get_clip_at_playhead"
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][1]).toEqual({ playheadUs: 1_000_000 });

    unmount();
  });

  it("seeks the preview video when playheadUs changes within a clip", async () => {
    mockInvoke.mockImplementation(async (cmd: string, args?: { playheadUs?: number }) => {
      if (cmd === "get_clip_at_playhead") {
        return {
          file_path: "/tmp/clip.mp4",
          seek_seconds: (args?.playheadUs ?? 0) / 1_000_000,
          clip_start_us: 0,
          clip_end_us: 12_000_000,
          source_in_us: 0,
        };
      }
      if (cmd === "get_overlays_at_time") return [];
      return null;
    });
    const { rerender } = render(
      <Preview
        playheadUs={1_000_000}
        playing={false}
        onPlayingChange={() => {}}
        onPlayheadChange={() => {}}
      />
    );
    const video = document.querySelector("video.preview-video") as HTMLVideoElement;

    await waitFor(() => {
      expect(video.currentTime).toBe(1);
    });

    rerender(
      <Preview
        playheadUs={4_000_000}
        playing={false}
        onPlayingChange={() => {}}
        onPlayheadChange={() => {}}
      />
    );

    await waitFor(() => {
      expect(video.currentTime).toBe(4);
    });
  });

  it("shows 'No clip at playhead' when no clip found", async () => {
    render(
      <Preview
        playheadUs={1_000_000}
        playing={false}
        onPlayingChange={() => {}}
        onPlayheadChange={() => {}}
      />
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(screen.getByText("No clip at playhead")).toBeTruthy();
  });

  it("renders an HTML video element", () => {
    render(
      <Preview
        playheadUs={0}
        playing={false}
        onPlayingChange={() => {}}
        onPlayheadChange={() => {}}
      />
    );
    expect(document.querySelector("video.preview-video")).toBeTruthy();
  });
});
