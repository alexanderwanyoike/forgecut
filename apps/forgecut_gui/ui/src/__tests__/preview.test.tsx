import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
