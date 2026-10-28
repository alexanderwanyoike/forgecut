// @vitest-environment node
import { expect, test, vi } from "vitest";
import { renderGraphic } from "../graphic-render";
vi.mock("node:fs", () => ({ existsSync: () => false }));

test.each(["darwin", "win32"])(
  "%s reports the Linux graphics boundary instead of asking to reinstall an absent runtime",
  async (platform) => {
    const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
    try {
      Object.defineProperty(process, "platform", { value: platform });
      const result = await renderGraphic(
        {
          output: "unused.mov",
          format: "prores",
          sourceHash: "a".repeat(64),
          width: 1920,
          height: 1080,
          fps: 30,
          duration: 1,
          renderFrames: 1,
          values: {},
          resources: {},
        },
        "unused",
      );
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "UNAVAILABLE",
          message: expect.stringContaining("Linux"),
        },
      });
    } finally {
      Object.defineProperty(process, "platform", descriptor);
    }
  },
);
