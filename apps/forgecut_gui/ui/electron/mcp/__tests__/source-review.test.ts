/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { generateReviewSource } from "../../backend/__tests__/source-review-fixture";
import { AppState } from "../../backend/state";
import { EditingService } from "../../backend/editing-service";
import type { JobSnapshot } from "../../shared/jobs";
import { startLocalBridge } from "../local-bridge";
import { createMcpServer } from "../server";

it.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)(
  "returns a contact sheet as native MCP image content with its source-range metadata",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-review-mcp-"));
    const state = new AppState();
    const service = new EditingService(state);
    const bridge = await startLocalBridge(service, directory);
    const server = createMcpServer(directory);
    const client = new Client({ name: "source-review", version: "1" });
    const [local, remote] = InMemoryTransport.createLinkedPair();
    try {
      const path = join(directory, "source.mp4");
      generateReviewSource(path);
      await service.execute("import_assets", { paths: [path] });
      await server.connect(remote);
      await client.connect(local);
      await client.callTool({
        name: "attach_session",
        arguments: { instanceId: bridge.session.id },
      });
      const request = {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        requestId: "review-sheet",
        assetId: state.project.assets[0].id,
        startUs: 0,
        endUs: 1000000,
        kind: "contact-sheet",
      };
      const started = await client.callTool({
        name: "start_source_review",
        arguments: request,
      });
      expect(
        started.structuredContent,
        JSON.stringify(started.structuredContent),
      ).toMatchObject({
        ok: true,
        value: { kind: "contact-sheet" },
      });
      const snapshot = started.structuredContent as {
        ok: true;
        value: JobSnapshot;
      };
      let completed = started;
      for (let attempt = 0; attempt < 300; attempt += 1) {
        completed = await client.callTool({
          name: "get_job",
          arguments: { sessionId: state.sessionId, jobId: snapshot.value.id },
        });
        const result = completed.structuredContent as {
          ok: true;
          value: JobSnapshot;
        };
        if (["completed", "failed", "cancelled"].includes(result.value.status))
          break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(completed.structuredContent).toMatchObject({
        ok: true,
        value: {
          status: "completed",
          result: {
            ok: true,
            value: {
              mimeType: "image/jpeg",
              assetId: request.assetId,
              startUs: 0,
              endUs: 1000000,
              columns: 4,
              rows: 3,
              bytes: expect.any(Number),
              timesUs: expect.any(Array),
            },
          },
        },
      });
      expect(
        completed.content.some(
          (content) =>
            content.type === "image" && content.mimeType === "image/jpeg",
        ),
      ).toBe(true);
      expect(JSON.stringify(completed.structuredContent)).not.toContain(
        '"data"',
      );
      expect(
        (
          await client.callTool({
            name: "start_source_review",
            arguments: request,
          })
        ).structuredContent,
      ).toMatchObject({ ok: true, value: { id: snapshot.value.id } });
    } finally {
      await client.close();
      await server.close();
      await bridge.close();
      await service.jobs.close();
      await service.closeGraphicsPreview();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
