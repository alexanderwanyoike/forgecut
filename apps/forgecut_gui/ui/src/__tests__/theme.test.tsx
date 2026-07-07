import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../lib/bridge", () => ({
  invoke: vi.fn().mockImplementation(async (cmd: string) => {
    if (cmd === "init_default_tracks") return { tracks: [], markers: [] };
    if (cmd === "get_clip_at_playhead") return null;
    if (cmd === "get_overlays_at_time") return [];
    if (cmd === "get_item_details") return null;
    return null;
  }),
  save: vi.fn(),
  open: vi.fn(),
  mediaUrl: (path: string) => `forgecut-media://${path}`,
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
