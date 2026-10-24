/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { generateReviewSource } from "./source-review-fixture";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import type { JobSnapshot } from "../../shared/jobs";

async function finish(service: EditingService, id: string) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const response = service.jobs.read(id, service.state.sessionId);
    if (!response.ok) throw new Error(response.error.message);
    if (["completed", "failed", "cancelled"].includes(response.value.status))
      return response.value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Source preview did not finish");
}

it.skipIf(
  spawnSync("ffmpeg", ["-version"]).status !== 0 ||
    spawnSync("ffprobe", ["-version"]).status !== 0,
)(
  "creates a bounded, decodable audio/video source preview and reuses its cache without editing the project",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-source-preview-"));
    const state = new AppState();
    const service = new EditingService(state);
    try {
      const source = join(directory, "source.mp4");
      generateReviewSource(source);
      expect(
        await service.execute("import_assets", { paths: [source] }),
      ).toMatchObject({ ok: true });
      const before = state.snapshot();
      const request = {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        requestId: "short-preview",
        assetId: state.project.assets[0].id,
        startUs: 500000,
        endUs: 1500000,
        kind: "preview",
      };
      const started = await service.execute("start_source_review", request);
      expect(started).toMatchObject({
        ok: true,
        value: { kind: "source-preview", label: "Source preview" },
      });
      if (!started.ok) throw new Error(started.error.message);
      const job = await finish(service, (started.value as JobSnapshot).id);
      expect(job).toMatchObject({
        status: "completed",
        result: {
          ok: true,
          value: {
            mimeType: "video/webm",
            assetId: request.assetId,
            startUs: 500000,
            endUs: 1500000,
          },
        },
      });
      if (!job.result?.ok) throw new Error("Missing preview");
      const value = job.result.value as { data: string };
      const bytes = Buffer.from(value.data, "base64");
      expect(bytes.length).toBeGreaterThan(100);
      expect(bytes.length).toBeLessThanOrEqual(512 * 1024);
      const output = join(directory, "preview.webm");
      await writeFile(output, bytes);
      const streams = spawnSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "stream=codec_name",
          "-of",
          "csv=p=0",
          output,
        ],
        { encoding: "utf8" },
      );
      expect(streams.status, streams.stderr).toBe(0);
      expect(streams.stdout).toContain("vp8");
      expect(streams.stdout).toContain("opus");
      const audio = spawnSync("ffmpeg", [
        "-v",
        "error",
        "-i",
        output,
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "s16le",
        "pipe:1",
      ]);
      expect(audio.status, audio.stderr.toString()).toBe(0);
      expect(audio.stdout.length).toBeGreaterThanOrEqual(15000);
      expect(audio.stdout.length).toBeLessThanOrEqual(18000);
      expect(state.snapshot()).toEqual(before);
      vi.stubEnv("PATH", directory);
      const repeat = await service.execute("start_source_review", {
        ...request,
        requestId: "cached-preview",
      });
      expect(repeat).toMatchObject({ ok: true });
      if (!repeat.ok) throw new Error(repeat.error.message);
      expect(
        (await finish(service, (repeat.value as JobSnapshot).id)).result,
      ).toEqual(job.result);
      expect(
        await service.execute("start_source_review", {
          ...request,
          requestId: "long-preview",
          startUs: 0,
          endUs: 5000001,
        }),
      ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
      expect(state.snapshot()).toEqual(before);
    } finally {
      vi.unstubAllEnvs();
      await service.jobs.close();
      await service.closeGraphicsPreview();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
