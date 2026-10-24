/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AppState } from "../../backend/state";
import { EditingService } from "../../backend/editing-service";
import { startLocalBridge } from "../local-bridge";
import { callBridge } from "../sessions";
import type { JobSnapshot } from "../../shared/jobs";

it.skipIf(spawnSync("ffprobe", ["-version"]).status !== 0)(
  "imports through a bounded job and retries without importing twice",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-jobs-"));
    const state = new AppState();
    const service = new EditingService(state);
    const bridge = await startLocalBridge(service, directory);
    try {
      const path = join(directory, "image.png");
      await writeFile(
        path,
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
          "base64",
        ),
      );
      const request = {
        action: "import",
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        requestId: "import-one",
        paths: [path],
      };
      const started = await callBridge<JobSnapshot>(bridge.session, request);
      expect(started.ok).toBe(true);
      if (!started.ok) throw new Error(started.error.message);
      let job = started.value;
      for (
        let attempt = 0;
        attempt < 100 && ["queued", "running"].includes(job.status);
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const read = await callBridge<JobSnapshot>(bridge.session, {
          action: "job",
          sessionId: state.sessionId,
          jobId: job.id,
        });
        if (!read.ok) throw new Error(read.error.message);
        job = read.value;
      }
      expect(job).toMatchObject({
        status: "completed",
        progress: 1,
        result: {
          ok: true,
          value: { assetIds: [state.project.assets[0]?.id] },
        },
      });
      expect(state.project.assets).toHaveLength(1);
      expect(await callBridge(bridge.session, request)).toMatchObject({
        ok: true,
        value: { id: job.id },
      });
      expect(state.project.assets).toHaveLength(1);
      state.undo();
      expect(state.project.assets).toEqual([]);
    } finally {
      await service.jobs.close();
      await bridge.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
