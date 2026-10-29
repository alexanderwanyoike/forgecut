/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { AppState } from "../../backend/state";
import { EditingService } from "../../backend/editing-service";
import { startLocalBridge } from "../local-bridge";
import { createMcpServer } from "../server";
import type { JobSnapshot } from "../../shared/jobs";

it.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)(
  "assembles three ranges, preserves a manual trim, undoes one agent batch and reopens the result",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-workflow-"));
    const state = new AppState();
    const editing = new EditingService(state);
    const bridge = await startLocalBridge(editing, directory);
    const server = createMcpServer(directory);
    const client = new Client({ name: "workflow", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      const path = join(directory, "source.mkv");
      const generated = spawnSync("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=gray:s=16x16:r=10:d=6",
        "-c:v",
        "ffv1",
        "-threads",
        "1",
        path,
      ]);
      expect(generated.status, generated.stderr.toString()).toBe(0);
      await editing.execute("update_project", {
        settings: { width: 64, height: 36 },
      });
      await editing.execute("init_default_tracks");
      await server.connect(st);
      await client.connect(ct);
      await client.callTool({
        name: "attach_session",
        arguments: { instanceId: bridge.session.id },
      });
      const imported = await client.callTool({
        name: "start_import",
        arguments: {
          sessionId: state.sessionId,
          expectedRevision: state.revision,
          requestId: "import",
          paths: [path],
        },
      });
      expect(imported.isError).toBe(false);
      const job = (imported.structuredContent as { value: JobSnapshot }).value;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const result = editing.jobs.read(job.id, state.sessionId);
        if (result.ok && result.value.status === "completed") break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(state.project.assets).toHaveLength(1);
      const assetId = state.project.assets[0].id;
      const trackId = state.project.timeline.tracks[0].id;
      const assembled = await client.callTool({
        name: "apply_edits",
        arguments: {
          sessionId: state.sessionId,
          expectedRevision: state.revision,
          requestId: "assemble",
          label: "Assemble three source ranges",
          operations: [0, 1, 2].map((index) => ({
            command: "add_clip_to_timeline",
            args: {
              assetId,
              trackId,
              timelineStartUs: index * 1000000,
              sourceInUs: index * 2000000,
              sourceOutUs: index * 2000000 + 1000000,
            },
          })),
        },
      });
      expect(assembled.isError, JSON.stringify(assembled)).toBe(false);
      const clips = state.project.timeline.tracks[0].items.map(
        (item) => item.VideoClip!,
      );
      expect(
        clips.map((clip) => [clip.source_in_us, clip.source_out_us]),
      ).toEqual([
        [0, 1000000],
        [2000000, 3000000],
        [4000000, 5000000],
      ]);
      expect(
        (
          await editing.execute("trim_clip", {
            itemId: clips[0].id,
            trimType: "out",
            newUs: 750000,
          })
        ).ok,
      ).toBe(true);
      const manual = state.project;
      const latest = await client.callTool({
        name: "read_timeline",
        arguments: { sessionId: state.sessionId, startUs: 0, endUs: 3000000 },
      });
      expect(latest.structuredContent).toMatchObject({
        ok: true,
        value: { revision: state.revision, total: 3 },
      });
      const changed = await client.callTool({
        name: "apply_edits",
        arguments: {
          sessionId: state.sessionId,
          expectedRevision: state.revision,
          requestId: "agent-trim",
          label: "Refine second range",
          operations: [
            {
              command: "trim_clip",
              args: { itemId: clips[1].id, trimType: "out", newUs: 2750000 },
            },
          ],
        },
      });
      expect(changed.isError).toBe(false);
      expect(state.project.timeline.tracks[0].items[0]).toEqual(
        manual.timeline.tracks[0].items[0],
      );
      expect((await editing.execute("undo")).ok).toBe(true);
      expect(state.project).toEqual(manual);
      const projectPath = join(directory, "result.forgecut");
      expect(
        (
          await client.callTool({
            name: "save_project",
            arguments: {
              sessionId: state.sessionId,
              expectedRevision: state.revision,
              path: projectPath,
            },
          })
        ).isError,
      ).toBe(false);
      const oldSession = state.sessionId;
      expect(
        (
          await client.callTool({
            name: "open_project",
            arguments: {
              sessionId: state.sessionId,
              expectedRevision: state.revision,
              path: projectPath,
            },
          })
        ).isError,
      ).toBe(false);
      expect(state.project).toEqual(manual);
      expect(state.sessionId).not.toBe(oldSession);
      const outputPath = join(directory, "result.mp4");
      const started = await client.callTool({
        name: "start_export",
        arguments: {
          sessionId: state.sessionId,
          expectedRevision: state.revision,
          requestId: "export-result",
          outputPath,
        },
      });
      expect(started.isError).toBe(false);
      let exportJob = (started.structuredContent as { value: JobSnapshot })
        .value;
      for (
        let attempt = 0;
        attempt < 100 &&
        ["queued", "running", "committing"].includes(exportJob.status);
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const result = await client.callTool({
          name: "get_job",
          arguments: { sessionId: state.sessionId, jobId: exportJob.id },
        });
        exportJob = (result.structuredContent as { value: JobSnapshot }).value;
      }
      expect(exportJob).toMatchObject({
        status: "completed",
        result: { ok: true, value: { outputPath } },
      });
      expect((await stat(outputPath)).size).toBeGreaterThan(0);
    } finally {
      await editing.jobs.close();
      await client.close();
      await server.close();
      await bridge.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
