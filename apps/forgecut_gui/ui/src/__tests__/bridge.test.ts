import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

import { mediaUrl } from "../lib/bridge";

describe("runtime bridge", () => {
  afterEach(() => {
    delete window.forgecut;
  });

  it("uses Electron media URL conversion when available", () => {
    window.forgecut = {
      invoke: vi.fn(),
      dialog: { open: vi.fn(), save: vi.fn() },
      events: { listen: vi.fn() },
      window: {
        scaleFactor: vi.fn(),
        onMoved: vi.fn(),
        onResized: vi.fn(),
      },
      mediaUrl: (path: string) => `file://${path}`,
    };

    expect(mediaUrl("/tmp/clip.mp4")).toBe("file:///tmp/clip.mp4");
  });

  it("falls back to the input path outside Electron", () => {
    expect(mediaUrl("/tmp/clip.mp4")).toBe("/tmp/clip.mp4");
  });
});
