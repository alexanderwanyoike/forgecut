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

it("creates, reads, resumes and cancels a durable batch through the official MCP SDK", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecut-batch-mcp-"));
  const directory = join(root, "outputs");
  const state = new AppState();
  const service = new EditingService(state);
  const bridge = await startLocalBridge(service, root);
  const server = createMcpServer(root);
  const client = new Client({ name: "batch-export", version: "1" });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await server.connect(remote);
    await client.connect(local);
    await client.callTool({
      name: "attach_session",
      arguments: { instanceId: bridge.session.id },
    });
    const request = {
      sessionId: state.sessionId,
      expectedRevision: state.revision,
      directory,
      sequenceIds: [state.project.default_sequence!.id],
    };
    const created = await client.callTool({
      name: "create_export_batch",
      arguments: request,
    });
    expect(created.structuredContent).toMatchObject({
      ok: true,
      value: { directory, entries: [{ status: "pending" }] },
    });
    const data = created.structuredContent as {
      ok: true;
      value: { id: string };
    };
    await service.execute("create_project");
    expect(
      (
        await client.callTool({
          name: "create_export_batch",
          arguments: { ...request, directory: join(root, "stale") },
        })
      ).structuredContent,
    ).toMatchObject({ ok: false, error: { code: "PROJECT_CHANGED" } });
    expect(
      (
        await client.callTool({
          name: "read_export_batch",
          arguments: { directory },
        })
      ).structuredContent,
    ).toMatchObject({ ok: true, value: { id: data.value.id } });
    service.jobs.start(
      {
        sessionId: state.sessionId,
        projectRevision: state.revision,
        requestId: "hold",
        kind: "frame",
        label: "Held media job",
        input: null,
      },
      async () => {
        await held;
        return { ok: true, value: null };
      },
    );
    expect(
      (
        await client.callTool({
          name: "resume_export_batch",
          arguments: { directory, batchId: data.value.id },
        })
      ).structuredContent,
    ).toMatchObject({ ok: true, value: { active: true } });
    for (let attempt = 0; attempt < 100; attempt++) {
      const read = await client.callTool({
        name: "read_export_batch",
        arguments: { directory },
      });
      const snapshot = read.structuredContent as {
        value: { entries: { status: string }[] };
      };
      if (snapshot.value.entries[0].status === "queued") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(
      (
        await client.callTool({
          name: "cancel_export_batch",
          arguments: { directory, batchId: data.value.id },
        })
      ).structuredContent,
    ).toMatchObject({ ok: true });
  } finally {
    release();
    await service.batches.close();
    await service.jobs.close();
    await client.close();
    await server.close();
    await bridge.close();
    await service.closeGraphicsPreview();
    await rm(root, { recursive: true, force: true });
  }
});
