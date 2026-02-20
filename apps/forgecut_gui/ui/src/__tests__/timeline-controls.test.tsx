import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock @tauri-apps/api/core
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockImplementation(async (cmd: string) => {
    if (cmd === "init_default_tracks") return { tracks: [], markers: [] };
    if (cmd === "get_snap_points") return [];
    return null;
  }),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

// Mock ResizeObserver
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", MockResizeObserver);

import Timeline from "../components/Timeline";

describe("Timeline controls", () => {
  const defaultProps = {
    playheadUs: 0,
    playing: false,
    onPlayheadChange: () => {},
    onPlayingChange: () => {},
    selectedClipId: null,
    onSelectedClipChange: () => {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders zoom percentage label", () => {
    render(<Timeline {...defaultProps} />);
    // Default is 100px/s → "100%"
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("zoom slider clamps to bounds", () => {
    render(<Timeline {...defaultProps} />);
    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(Number(slider.min)).toBe(10);
    expect(Number(slider.max)).toBe(500);
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
