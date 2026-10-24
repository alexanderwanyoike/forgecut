/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { startMediaJob } from "../media-jobs";

it.skipIf(spawnSync("ffprobe", ["-version"]).status !== 0)(
  "does not report a committed media import as cancelled",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-import-commit-"));
    const state = new AppState();
    const service = new EditingService(state);
    let jobId = "";
    let cancelled: unknown;
    const unlisten = state.subscribe(() => {
      if (state.project.assets.length === 1)
        cancelled = service.jobs.cancel(jobId, state.sessionId);
    });
    try {
      const path = join(directory, "image.png");
      await writeFile(
        path,
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
          "base64",
        ),
      );
      const started = startMediaJob(service, {
        action: "import",
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        requestId: "commit-import",
        paths: [path],
      });
      if (!started.ok) throw new Error(started.error.message);
      jobId = started.value.id;
      let status = "";
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const current = service.jobs.read(jobId, state.sessionId);
        if (!current.ok) throw new Error(current.error.message);
        status = current.value.status;
        if (["completed", "failed", "cancelled"].includes(status)) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(cancelled).toMatchObject({
        ok: false,
        error: { code: "COMMITTING" },
      });
      expect(status).toBe("completed");
      expect(state.project.assets).toHaveLength(1);
    } finally {
      unlisten();
      await service.jobs.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
