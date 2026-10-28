/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import type { JobSnapshot } from "../../shared/jobs";

it.each([
  { sequenceId: undefined, code: "INVALID_INPUT" },
  { sequenceId: "missing-sequence", code: "NOT_FOUND" },
])(
  "rejects an ambiguous or missing export target with $code",
  async ({ sequenceId, code }) => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-export-target-"));
    const state = new AppState();
    const service = new EditingService(state);
    try {
      await service.execute("create_sequence", { name: "Clip" });
      const before = state.snapshot();
      expect(
        await service.execute("export_project", {
          outputPath: join(directory, "unused.mp4"),
          ...(sequenceId ? { sequenceId } : {}),
        }),
      ).toMatchObject({ ok: false, error: { code } });
      expect(state.snapshot()).toEqual(before);
    } finally {
      await service.jobs.close();
      await service.closePreviews();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it.skipIf(
  spawnSync("ffmpeg", ["-version"]).status !== 0 ||
    spawnSync("ffprobe", ["-version"]).status !== 0,
)(
  "exports the explicitly targeted sequence snapshot while editing continues",
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "forgecut-sequence-export-"),
    );
    const state = new AppState();
    const service = new EditingService(state);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      state.executeProjectChange((project) => {
        project.settings = {
          ...project.settings,
          width: 96,
          height: 54,
          fps: 30,
        };
        project.timeline.duration_us = 1000000;
      });
      await service.execute("create_sequence", {
        name: "Portrait",
        settings: { width: 64, height: 96, fps: 10 },
      });
      const clip = state.project.sequences![0].id;
      state.executeProjectChange((project) => {
        project.sequences![0].timeline.duration_us = 1000000;
      });
      const root = state.project.default_sequence!.id;
      const revision = state.revision;
      service.jobs.start(
        {
          sessionId: state.sessionId,
          projectRevision: revision,
          requestId: "hold-export",
          kind: "frame",
          label: "Held test job",
          input: null,
        },
        async () => {
          await held;
          return { ok: true, value: null };
        },
      );
      const outputPath = join(directory, "portrait.mp4");
      const started = await service.execute(
        "export_project",
        { outputPath },
        {
          sessionId: state.sessionId,
          sequenceId: clip,
        },
      );
      expect(started).toMatchObject({
        ok: true,
        value: { status: "queued", projectRevision: revision },
      });
      if (!started.ok) throw new Error(started.error.message);
      const job = started.value as JobSnapshot;
      expect(state.snapshot().activeSequenceId).toBe(root);
      state.executeProjectChange((project) => {
        project.sequences![0].settings.width = 128;
      });
      release();
      await vi.waitFor(
        () => {
          expect(service.jobs.read(job.id, job.sessionId)).toMatchObject({
            ok: true,
            value: {
              status: "completed",
              result: { ok: true, value: { outputPath } },
            },
          });
        },
        { timeout: 10000 },
      );
      const probe = spawnSync("ffprobe", [
        "-v",
        "error",
        "-show_streams",
        "-of",
        "json",
        outputPath,
      ]);
      expect(probe.status, probe.stderr.toString()).toBe(0);
      const data = JSON.parse(probe.stdout.toString()) as {
        streams: {
          codec_type: string;
          width?: number;
          height?: number;
          avg_frame_rate?: string;
          nb_frames?: string;
        }[];
      };
      expect(
        data.streams.find((stream) => stream.codec_type === "video"),
      ).toMatchObject({
        width: 64,
        height: 96,
        avg_frame_rate: "10/1",
        nb_frames: "10",
      });
      expect(state.project.settings.width).toBe(96);
      expect(state.project.sequences![0].settings.width).toBe(128);
    } finally {
      release();
      await service.jobs.close();
      await service.closePreviews();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
