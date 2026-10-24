/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { exportProject } from "../exporter";

const cleanup = vi.hoisted(() => ({ denied: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (cleanup.denied)
        throw Object.assign(new Error("cleanup denied"), { code: "EACCES" });
      return actual.rm(...args);
    },
  };
});

it.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)(
  "reports cleanup separately after publishing a complete output",
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "forgecut-published-cleanup-"),
    );
    try {
      const state = new AppState();
      const editing = new EditingService(state);
      await editing.execute("update_project", {
        settings: { width: 64, height: 36, fps: 10 },
      });
      await editing.execute("add_text_overlay", {
        trackId: "titles",
        timelineStartUs: 0,
        durationUs: 1000000,
        text: "Card",
        fontSize: 10,
        color: "#ffffff",
        x: 0,
        y: 0,
      });
      cleanup.denied = true;
      const outputPath = join(directory, "result.mp4");
      expect(await exportProject(state.project, outputPath)).toMatchObject({
        ok: true,
        value: {
          outputPath,
          cleanupWarning: expect.stringContaining("cleanup denied"),
        },
      });
      expect((await stat(outputPath)).size).toBeGreaterThan(0);
    } finally {
      cleanup.denied = false;
      await rm(directory, { recursive: true, force: true });
    }
  },
);
