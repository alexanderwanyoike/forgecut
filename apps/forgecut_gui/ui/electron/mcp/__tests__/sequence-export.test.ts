/** @vitest-environment node */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { AppState } from "../../backend/state";
import { EditingService } from "../../backend/editing-service";
import { startLocalBridge } from "../local-bridge";
import { createMcpServer } from "../server";

it.each([undefined, { startUs: 0, endUs: 500000 }])(
  "accepts explicit MCP export targets and range %j in retry identity",
  async (range) => {
    const directory = await mkdtemp(
      join(tmpdir(), "forgecut-sequence-export-mcp-"),
    );
    const state = new AppState();
    const service = new EditingService(state);
    const bridge = await startLocalBridge(service, directory);
    const server = createMcpServer(directory);
    const client = new Client({ name: "sequence-export", version: "1" });
    const [local, remote] = InMemoryTransport.createLinkedPair();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await service.execute("create_sequence", { name: "Portrait" });
      const root = state.project.default_sequence!.id;
      const clip = state.project.sequences![0].id;
      service.jobs.start(
        {
          sessionId: state.sessionId,
          projectRevision: state.revision,
          requestId: "hold",
          kind: "frame",
          label: "Held test job",
          input: null,
        },
        async () => {
          await held;
          return { ok: true, value: null };
        },
      );
      await server.connect(remote);
      await client.connect(local);
      await client.callTool({
        name: "attach_session",
        arguments: { instanceId: bridge.session.id },
      });
      const request = {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        requestId: "portrait-export",
        outputPath: join(directory, "portrait.mp4"),
        sequenceId: clip,
        ...(range ? { range } : {}),
      };
      const before = state.snapshot();
      const started = await client.callTool({
        name: "start_export",
        arguments: request,
      });
      expect(started.structuredContent, JSON.stringify(started)).toMatchObject({
        ok: true,
        value: { kind: "export", status: "queued" },
      });
      const retried = await client.callTool({
        name: "start_export",
        arguments: request,
      });
      expect(retried.structuredContent).toEqual(started.structuredContent);
      expect(
        (
          await client.callTool({
            name: "start_export",
            arguments: { ...request, sequenceId: root },
          })
        ).structuredContent,
      ).toMatchObject({
        ok: false,
        error: { code: "REQUEST_REUSED" },
      });
      expect(
        (
          await client.callTool({
            name: "start_export",
            arguments: {
              ...request,
              range: { startUs: 100000, endUs: 500000 },
            },
          })
        ).structuredContent,
      ).toMatchObject({ ok: false, error: { code: "REQUEST_REUSED" } });
      const { sequenceId: _target, ...ambiguous } = request;
      expect(
        (
          await client.callTool({
            name: "start_export",
            arguments: { ...ambiguous, requestId: "missing-target" },
          })
        ).structuredContent,
      ).toMatchObject({
        ok: false,
        error: { code: "INVALID_INPUT" },
      });
      expect(
        (
          await client.callTool({
            name: "start_export",
            arguments: {
              ...request,
              sequenceId: "absent",
              requestId: "unknown-target",
            },
          })
        ).structuredContent,
      ).toMatchObject({
        ok: false,
        error: { code: "NOT_FOUND" },
      });
      expect(state.snapshot()).toEqual(before);
      expect(
        await service.execute("delete_sequence", { sequenceId: clip }),
      ).toMatchObject({ ok: true });
      const deleted = state.snapshot();
      const afterDeletion = await client.callTool({
        name: "start_export",
        arguments: request,
      });
      expect(afterDeletion.structuredContent).toEqual(
        started.structuredContent,
      );
      expect(state.snapshot()).toEqual(deleted);
    } finally {
      release();
      await client.close();
      await server.close();
      await bridge.close();
      await service.jobs.close();
      await service.closeGraphicsPreview();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
