/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../server";
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
      const started = await callBridge(bridge.session, request);
      expect(started.ok).toBe(true);
      if (!started.ok) throw new Error(started.error.message);
      let job = started.value as JobSnapshot;
      for (
        let attempt = 0;
        attempt < 100 && ["queued", "running"].includes(job.status);
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const read = await callBridge(bridge.session, {
          action: "job",
          sessionId: state.sessionId,
          jobId: job.id,
        });
        if (!read.ok) throw new Error(read.error.message);
        job = read.value as JobSnapshot;
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

it.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)(
  "serves source frame jobs as MCP images without duplicating image data in JSON",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-frame-job-"));
    const state = new AppState();
    const service = new EditingService(state);
    const bridge = await startLocalBridge(service, directory);
    const server = createMcpServer(directory);
    const client = new Client({ name: "frame-test", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      const path = join(directory, "image.png");
      await writeFile(
        path,
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
          "base64",
        ),
      );
      state.executeProjectChange((project) => {
        project.assets.push({
          id: "image",
          name: "Image",
          path,
          kind: "Image",
          probe: null,
        });
      });
      await server.connect(st);
      await client.connect(ct);
      await client.callTool({
        name: "attach_session",
        arguments: { instanceId: bridge.session.id },
      });
      const started = await client.callTool({
        name: "start_source_frame",
        arguments: {
          sessionId: state.sessionId,
          expectedRevision: state.revision,
          requestId: "frame",
          assetId: "image",
          timeUs: 0,
        },
      });
      expect(started.isError).toBe(false);
      const job = (started.structuredContent as { value: JobSnapshot }).value;
      let read = started;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        read = await client.callTool({
          name: "get_job",
          arguments: { sessionId: state.sessionId, jobId: job.id },
        });
        if (read.content.some((content) => content.type === "image")) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(read.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "image", mimeType: "image/jpeg" }),
        ]),
      );
      expect(JSON.stringify(read.structuredContent)).not.toContain("data");
      expect(read.structuredContent).toMatchObject({
        ok: true,
        value: { status: "completed" },
      });
    } finally {
      await service.jobs.close();
      await client.close();
      await server.close();
      await bridge.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
