import { describe, expect, it, vi, afterEach } from "vitest";

import { invoke, mediaUrl } from "../lib/bridge";

describe("runtime bridge", () => {
  afterEach(() => {
    delete window.forgecut;
  });

  it("uses Electron media URL conversion", () => {
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

  it("fails clearly outside Electron", async () => {
    expect(() => mediaUrl("/tmp/clip.mp4")).toThrow(
      "ForgeCut Electron bridge is not available",
    );
    expect(() => invoke("get_assets")).toThrow(
      "ForgeCut Electron bridge is not available",
    );
  });
});
