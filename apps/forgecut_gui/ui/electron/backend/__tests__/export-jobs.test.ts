/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import type { JobSnapshot } from "../../shared/jobs";

it.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)(
  "queues exports immediately and renders the captured revision while editing continues",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "forgecut-export-job-"));
    const state = new AppState();
    const editing = new EditingService(state);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await editing.execute("update_project", {
        settings: { width: 64, height: 36, fps: 10 },
      });
      await editing.execute("add_text_overlay", {
        trackId: "titles",
        timelineStartUs: 0,
        durationUs: 1000000,
        text: "Original",
        fontSize: 10,
        color: "#ffffff",
        x: 0,
        y: 0,
      });
      const revision = state.revision;
      editing.jobs.start(
        {
          sessionId: state.sessionId,
          projectRevision: revision,
          requestId: "held",
          kind: "frame",
          label: "Held",
          input: null,
        },
        async () => {
          await held;
          return { ok: true, value: null };
        },
      );
      const outputPath = join(dir, "result.mp4");
      const pending = editing.execute("export_project", { outputPath });
      state.createProject();
      await editing.execute("update_project", { settings: { width: 128 } });
      const started = await pending;
      expect(started).toMatchObject({
        ok: true,
        value: { kind: "export", status: "queued", projectRevision: revision },
      });
      if (!started.ok) throw new Error(started.error.message);
      const job = started.value as JobSnapshot;
      expect(
        await editing.execute("get_media_job", {
          sessionId: job.sessionId,
          jobId: job.id,
        }),
      ).toMatchObject({ ok: true, value: { id: job.id, status: "queued" } });
      release();
      await vi.waitFor(() =>
        expect(editing.jobs.read(job.id, job.sessionId)).toMatchObject({
          ok: true,
          value: {
            status: "completed",
            result: { ok: true, value: { outputPath } },
          },
        }),
      );
      const probe = spawnSync("ffprobe", [
        "-v",
        "error",
        "-show_streams",
        "-of",
        "json",
        outputPath,
      ]);
      expect(
        JSON.parse(probe.stdout.toString()).streams.find(
          (stream: { codec_type: string }) => stream.codec_type === "video",
        ).width,
      ).toBe(64);
      expect(state.project.settings.width).toBe(128);
    } finally {
      release();
      await editing.jobs.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

it("cancels a queued export through the renderer command boundary", async () => {
  const state = new AppState();
  const editing = new EditingService(state);
  editing.jobs.start(
    {
      sessionId: state.sessionId,
      projectRevision: 0,
      requestId: "held",
      kind: "frame",
      label: "Held",
      input: null,
    },
    async (signal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      return { ok: true, value: null };
    },
  );
  try {
    const started = await editing.execute("export_project", {
      outputPath: join(tmpdir(), "never-rendered.mp4"),
    });
    if (!started.ok) throw new Error(started.error.message);
    const job = started.value as JobSnapshot;
    const reading = editing.execute("get_media_job", {
      sessionId: job.sessionId,
      jobId: job.id,
    });
    state.createProject();
    expect(await reading).toMatchObject({
      ok: true,
      value: { id: job.id, sessionId: job.sessionId },
    });
    expect(
      await editing.execute("cancel_media_job", {
        sessionId: job.sessionId,
        jobId: job.id,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        status: "cancelled",
        result: { ok: false, error: { code: "CANCELLED" } },
      },
    });
  } finally {
    await editing.jobs.close();
  }
});
