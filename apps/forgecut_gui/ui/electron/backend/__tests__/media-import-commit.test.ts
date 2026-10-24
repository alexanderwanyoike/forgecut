/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { startMediaJob } from "../media-jobs";

afterEach(() => vi.unstubAllEnvs());
for (const mode of ["import", "resource"] as const) {
  it.skipIf(
    mode === "import" && spawnSync("ffprobe", ["-version"]).status !== 0,
  )(`does not report a committed ${mode} import as cancelled`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-import-commit-"));
    vi.stubEnv("FORGECUT_RESOURCE_DIR", join(directory, "cache"));
    const state = new AppState();
    const service = new EditingService(state);
    let jobId = "";
    let cancelled: unknown;
    const unlisten = state.subscribe(() => {
      if (
        state.project.assets.length + (state.project.resources?.length ?? 0) ===
        1
      )
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
      const identity = {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        requestId: "commit-import",
      };
      const started = startMediaJob(
        service,
        mode === "import"
          ? { ...identity, action: "import", paths: [path] }
          : {
              ...identity,
              action: "resource",
              resource: {
                path,
                kind: "Image",
                license: { identifier: "test-only", text: "Generated fixture" },
              },
            },
      );
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
      expect(
        mode === "import" ? state.project.assets : state.project.resources,
      ).toHaveLength(1);
    } finally {
      unlisten();
      await service.jobs.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
