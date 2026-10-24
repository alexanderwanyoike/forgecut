/** @vitest-environment node */
import { chmodSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { exportProject } from "../exporter";

it("preserves an existing output and leaves no staging files for a cancelled export", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-cancel-export-"));
  try {
    const path = join(directory, "output.mp4");
    await writeFile(path, "existing export");
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
    const controller = new AbortController();
    controller.abort();
    expect(
      await exportProject(state.project, path, { signal: controller.signal }),
    ).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
    expect(await readFile(path, "utf8")).toBe("existing export");
    expect(await readdir(directory)).toEqual(["output.mp4"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)(
  "stops a running export before replacing its destination",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-running-export-"));
    try {
      const path = join(directory, "output.mp4");
      await writeFile(path, "existing export");
      const state = new AppState();
      const editing = new EditingService(state);
      await editing.execute("update_project", {
        settings: { width: 64, height: 36, fps: 10 },
      });
      await editing.execute("add_text_overlay", {
        trackId: "titles",
        timelineStartUs: 0,
        durationUs: 60000000,
        text: "Card",
        fontSize: 10,
        color: "#ffffff",
        x: 0,
        y: 0,
      });
      const controller = new AbortController();
      expect(
        await exportProject(state.project, path, {
          signal: controller.signal,
          onProgress: () => controller.abort(),
        }),
      ).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
      expect(await readFile(path, "utf8")).toBe("existing export");
      expect(await readdir(directory)).toEqual(["output.mp4"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it.skipIf(
  process.platform !== "linux" ||
    process.getuid?.() === 0 ||
    spawnSync("ffmpeg", ["-version"]).status !== 0,
)(
  "retains cancellation as a typed outcome when staging cleanup is denied",
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "forgecut-cleanup-failure-"),
    );
    let locked: string | undefined;
    try {
      const state = new AppState();
      const editing = new EditingService(state);
      await editing.execute("update_project", {
        settings: { width: 64, height: 36, fps: 10 },
      });
      await editing.execute("add_text_overlay", {
        trackId: "titles",
        timelineStartUs: 0,
        durationUs: 60000000,
        text: "Card",
        fontSize: 10,
        color: "#ffffff",
        x: 0,
        y: 0,
      });
      const controller = new AbortController();
      const result = await exportProject(
        state.project,
        join(directory, "result.mp4"),
        {
          signal: controller.signal,
          onProgress: () => {
            if (locked) return;
            const name = readdirSync(directory).find((candidate) =>
              candidate.startsWith(".forgecut-export-"),
            );
            if (!name) throw new Error("Staging directory was not created.");
            locked = join(directory, name);
            chmodSync(locked, 0);
            controller.abort();
          },
        },
      );
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "CANCELLED",
          message: expect.stringContaining("cleanup"),
        },
      });
    } finally {
      if (locked) chmodSync(locked, 0o700);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
