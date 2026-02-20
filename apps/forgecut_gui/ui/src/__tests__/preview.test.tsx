import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Preview from "../components/Preview";

// Mock @tauri-apps/api/core
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

describe("Preview component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: get_media_port returns a port, get_clip_at_playhead returns null
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_media_port") return 9000;
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
    // Play symbol
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
    // Stop symbol
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
    // 65.5 seconds = 00:01:05.500
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

    // Wait for effects to run
    await new Promise((r) => setTimeout(r, 50));

    // Should have been called with playhead value
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

    // Wait for effects
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.getByText("No clip at playhead")).toBeTruthy();
  });
});
