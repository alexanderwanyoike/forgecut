/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import type { JobSnapshot } from "../../shared/jobs";

it.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)(
  "reviews a bounded source range as a contact sheet and waveform without editing the project",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-source-review-"));
    const state = new AppState();
    const service = new EditingService(state);
    try {
      const path = join(directory, "source.mp4");
      const generated = spawnSync("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=64x36:rate=10",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=8000",
        "-t",
        "2",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        path,
      ]);
      expect(generated.status, generated.stderr?.toString()).toBe(0);
      const imported = await service.execute("import_assets", {
        paths: [path],
      });
      expect(imported).toMatchObject({ ok: true });
      const assetId = state.project.assets[0].id;
      const before = state.snapshot();
      const request = {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        requestId: "sheet",
        assetId,
        startUs: 500000,
        endUs: 1500000,
        kind: "contact-sheet",
      };
      const started = await service.execute("start_source_review", request);
      expect(started).toMatchObject({
        ok: true,
        value: { kind: "contact-sheet" },
      });
      if (!started.ok) throw new Error(started.error.message);
      const jobId = (started.value as JobSnapshot).id;
      const finish = async (id: string) => {
        for (let attempt = 0; attempt < 300; attempt += 1) {
          const result = service.jobs.read(id, state.sessionId);
          if (!result.ok) throw new Error(result.error.message);
          if (
            ["completed", "failed", "cancelled"].includes(result.value.status)
          )
            return result.value;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Source review did not finish");
      };
      const sheet = await finish(jobId);
      expect(sheet).toMatchObject({
        status: "completed",
        result: {
          ok: true,
          value: {
            mimeType: "image/jpeg",
            assetId,
            startUs: 500000,
            endUs: 1500000,
            columns: 4,
            rows: 3,
          },
        },
      });
      const value = sheet.result?.ok
        ? (sheet.result.value as { data: string; timesUs: number[] })
        : undefined;
      expect(value).toBeDefined();
      expect(Buffer.from(value!.data, "base64").subarray(0, 3)).toEqual(
        Buffer.from([255, 216, 255]),
      );
      expect(Buffer.byteLength(value!.data, "base64")).toBeLessThanOrEqual(
        512 * 1024,
      );
      expect(value!.timesUs).toHaveLength(12);
      expect(value!.timesUs[0]).toBe(500000);
      expect(value!.timesUs[11]).toBeLessThan(1500000);
      expect(
        await service.execute("start_source_review", request),
      ).toMatchObject({ ok: true, value: { id: jobId } });
      const waveform = await service.execute("start_source_review", {
        ...request,
        requestId: "wave",
        kind: "waveform",
      });
      expect(waveform).toMatchObject({ ok: true });
      const wave = await finish(
        (waveform.ok ? (waveform.value as JobSnapshot) : sheet).id,
      );
      expect(wave).toMatchObject({
        status: "completed",
        result: {
          ok: true,
          value: { assetId, startUs: 500000, endUs: 1500000, sampleRate: 8000 },
        },
      });
      const audio = wave.result?.ok
        ? (wave.result.value as { peaks: [number, number][] })
        : undefined;
      expect(audio!.peaks.length).toBeGreaterThan(0);
      expect(audio!.peaks.length).toBeLessThanOrEqual(512);
      expect(
        audio!.peaks.some(([low, high]) => low < -0.01 && high > 0.01),
      ).toBe(true);
      expect(state.snapshot()).toEqual(before);
      vi.stubEnv("PATH", directory);
      try {
        const repeat = await service.execute("start_source_review", {
          ...request,
          requestId: "cached-sheet",
        });
        expect(repeat).toMatchObject({ ok: true });
        const cached = await finish(
          (repeat.ok ? (repeat.value as JobSnapshot) : sheet).id,
        );
        expect(cached.result).toEqual(sheet.result);
        state.executeProjectChange((project) => {
          project.assets[0].probe!.duration_us = 1_000_000;
        });
        const shorter = await service.execute("start_source_review", {
          ...request,
          expectedRevision: state.revision,
          requestId: "shorter-source",
        });
        expect(
          await finish(
            (shorter.ok ? (shorter.value as JobSnapshot) : sheet).id,
          ),
        ).toMatchObject({
          status: "failed",
          result: { ok: false, error: { code: "INVALID_INPUT" } },
        });
        state.undo();
        await utimes(path, new Date("2030-01-01"), new Date("2030-01-01"));
        const changed = await service.execute("start_source_review", {
          ...request,
          requestId: "changed-source",
          expectedRevision: state.revision,
        });
        const invalidated = await finish(
          (changed.ok ? (changed.value as JobSnapshot) : sheet).id,
        );
        expect(invalidated).toMatchObject({
          status: "failed",
          result: { ok: false, error: { code: "IO_ERROR" } },
        });
      } finally {
        vi.unstubAllEnvs();
      }
      expect(state.project).toEqual(before.project);
      expect(
        await service.execute("start_source_review", {
          ...request,
          requestId: "oversized",
          endUs: 31_000_000,
        }),
      ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    } finally {
      await service.jobs.close();
      await service.closeGraphicsPreview();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
