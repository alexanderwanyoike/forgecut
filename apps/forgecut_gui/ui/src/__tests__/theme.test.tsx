import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock @tauri-apps/api/core
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockImplementation(async (cmd: string) => {
    if (cmd === "init_default_tracks") return { tracks: [], markers: [] };
    if (cmd === "get_clip_at_playhead") return null;
    if (cmd === "get_overlays_at_time") return [];
    if (cmd === "mpv_start") return undefined;
    if (cmd === "mpv_stop") return undefined;
    if (cmd === "mpv_pause") return undefined;
    if (cmd === "mpv_seek") return undefined;
    if (cmd === "mpv_load_file") return undefined;
    if (cmd === "get_item_details") return null;
    return null;
  }),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

// Mock @tauri-apps/plugin-dialog
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
  open: vi.fn(),
}));

// Mock @tauri-apps/api/window
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    scaleFactor: () => Promise.resolve(1.0),
    innerPosition: () => Promise.resolve({ x: 0, y: 0 }),
    onMoved: () => Promise.resolve(() => {}),
    onResized: () => Promise.resolve(() => {}),
  }),
}));

// Mock ResizeObserver
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", MockResizeObserver);

import App from "../App";

describe("Theme toggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to dark theme", () => {
    render(<App />);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("toggles to light on click", () => {
    render(<App />);
    const btn = screen.getByText("Light");
    fireEvent.click(btn);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("persists theme to localStorage", () => {
    render(<App />);
    const btn = screen.getByText("Light");
    fireEvent.click(btn);
    expect(localStorage.getItem("forgecut-theme")).toBe("light");
  });

  it("reads theme from localStorage on mount", () => {
    localStorage.setItem("forgecut-theme", "light");
    render(<App />);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(screen.getByText("Dark")).toBeTruthy();
  });
});
