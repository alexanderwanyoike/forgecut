/** @vitest-environment node */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { AppState } from "../../backend/state";
import { EditingService } from "../../backend/editing-service";
import type { JobSnapshot } from "../../shared/jobs";
import { startLocalBridge } from "../local-bridge";
import { createMcpServer } from "../server";

it("collects a captured project through MCP and replays the same request after later edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgecut-collection-mcp-"));
  const state = new AppState();
  const service = new EditingService(state);
  const activities: string[] = [];
  const bridge = await startLocalBridge(service, root, label => { activities.push(label); });
  const server = createMcpServer(root);
  const client = new Client({ name: "project-collection", version: "1" });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    await server.connect(remote);
    await client.connect(local);
    await client.callTool({ name: "attach_session", arguments: { instanceId: bridge.session.id } });
    service.jobs.start({ sessionId: state.sessionId, projectRevision: state.revision, requestId: "held", kind: "frame", label: "Held job", input: null }, async () => { await held; return { ok: true, value: null }; });
    const request = { sessionId: state.sessionId, expectedRevision: state.revision, requestId: crypto.randomUUID(), directory: join(root, "collected"), assetIds: [] };
    const result = await client.callTool({ name: "start_project_collection", arguments: request });
    expect(result.structuredContent).toMatchObject({ ok: true, value: { kind: "collect", status: "queued" } });
    const data = result.structuredContent as { ok: true; value: JobSnapshot };
    expect(activities).toContain("Collect project");
    state.executeProjectChange(project => { project.name = "Manual change"; });
    const current = state.snapshot();
    const replay = await client.callTool({ name: "start_project_collection", arguments: request });
    expect(replay.structuredContent).toMatchObject({ ok: true, value: { id: data.value.id } });
    release();
    let completed: unknown;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const response = await client.callTool({ name: "get_job", arguments: { sessionId: data.value.sessionId, jobId: data.value.id } });
      const status = response.structuredContent as { ok: true; value: JobSnapshot };
      completed = status;
      if (["completed", "failed", "cancelled"].includes(status.value.status)) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(completed).toMatchObject({ ok: true, value: { status: "completed", result: { ok: true, value: { copiedAssets: 0, externalAssets: 0 } } } });
    expect(JSON.parse(await readFile(join(request.directory, "project.forgecut"), "utf8"))).toMatchObject({ name: "Untitled" });
    expect(state.snapshot()).toEqual(current);
  } finally {
    release();
    await service.jobs.close();
    await service.closeGraphicsPreview();
    await client.close();
    await server.close();
    await bridge.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
