/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { exportProject } from "../exporter";
import type { JobSnapshot } from "../../shared/jobs";

it.skipIf(
  ["ffmpeg", "ffprobe"].some(
    (tool) => spawnSync(tool, ["-version"]).status !== 0,
  ),
)(
  "exports a WebM preset with VP9 and Opus while retaining portrait dimensions and review timing",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-export-preset-"));
    const state = new AppState();
    const service = new EditingService(state);
    try {
      expect(
        await service.execute("update_project", {
          settings: { width: 36, height: 64, fps: 10, sample_rate: 44100 },
        }),
      ).toMatchObject({ ok: true });
      expect(
        await service.execute("set_sequence_end", { endUs: 2000000 }),
      ).toMatchObject({ ok: true });
      const before = state.snapshot();
      const outputPath = join(directory, "portrait.webm");
      const started = await service.execute("export_project", {
        outputPath,
        preset: "webm",
        range: { startUs: 1250000, endUs: 1850000 },
      });
      expect(started).toMatchObject({ ok: true, value: { kind: "export" } });
      if (!started.ok) throw new Error(started.error.message);
      let job = started.value as JobSnapshot;
      for (
        let attempt = 0;
        attempt < 300 &&
        !["completed", "failed", "cancelled"].includes(job.status);
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const response = service.jobs.read(job.id, state.sessionId);
        if (!response.ok) throw new Error(response.error.message);
        job = response.value;
      }
      expect(job).toMatchObject({ status: "completed", result: { ok: true } });
      const probe = spawnSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-count_frames",
          "-show_entries",
          "stream=codec_name,width,height,sample_rate,nb_read_frames",
          "-of",
          "json",
          outputPath,
        ],
        { encoding: "utf8" },
      );
      expect(probe.status, probe.stderr).toBe(0);
      expect(JSON.parse(probe.stdout).streams).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            codec_name: "vp9",
            width: 36,
            height: 64,
            nb_read_frames: "6",
          }),
          expect.objectContaining({ codec_name: "opus", sample_rate: "48000" }),
        ]),
      );
      expect(state.snapshot()).toEqual(before);
    } finally {
      await service.jobs.close();
      await service.closeGraphicsPreview();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it("rejects a mismatched preset extension before replacing a file or creating staging", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-preset-extension-"));
  const state = new AppState();
  const service = new EditingService(state);
  try {
    await service.execute("update_project", {
      settings: { width: 64, height: 36, fps: 10 },
    });
    await service.execute("set_sequence_end", { endUs: 200000 });
    const outputPath = join(directory, "keep.mp4");
    await writeFile(outputPath, "Existing export");
    expect(
      await exportProject(state.project, outputPath, { preset: "webm" }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(await readFile(outputPath, "utf8")).toBe("Existing export");
    expect(await readdir(directory)).toEqual(["keep.mp4"]);
  } finally {
    await service.jobs.close();
    await service.closeGraphicsPreview();
    await rm(directory, { recursive: true, force: true });
  }
});
