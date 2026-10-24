/** @vitest-environment node */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { AppState } from "../../backend/state";
import { EditingService } from "../../backend/editing-service";
import { graphicTemplates } from "../../backend/graphic-catalog";
import { startLocalBridge } from "../local-bridge";
import { createMcpServer } from "../server";

it("checks real component source through a bounded MCP job without returning compiled code", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-code-mcp-"));
  const state = new AppState();
  const service = new EditingService(state);
  const bridge = await startLocalBridge(service, directory);
  const server = createMcpServer(directory);
  const client = new Client({ name: "source-check", version: "1" });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(remote);
    await client.connect(local);
    await client.callTool({
      name: "attach_session",
      arguments: { instanceId: bridge.session.id },
    });
    const source = graphicTemplates()[0].source;
    const started = await client.callTool({
      name: "start_graphic_source_check",
      arguments: {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        requestId: "source",
        source,
      },
    });
    expect(started.structuredContent).toMatchObject({
      ok: true,
      value: { kind: "compile", id: expect.any(String) },
    });
    const jobs = started.structuredContent as {
      ok: true;
      value: { id: string };
    };
    let finished: unknown;
    for (let attempt = 0; attempt < 300; attempt++) {
      const result = await client.callTool({
        name: "get_job",
        arguments: { sessionId: state.sessionId, jobId: jobs.value.id },
      });
      const data = result.structuredContent as {
        ok: boolean;
        value: { status: string };
      };
      if (
        data.value &&
        ["completed", "failed", "cancelled"].includes(data.value.status)
      ) {
        finished = result.structuredContent;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(finished).toMatchObject({
      ok: true,
      value: {
        status: "completed",
        result: { ok: true, value: { valid: true, diagnostics: [] } },
      },
    });
    expect(JSON.stringify(finished)).not.toContain("require(");
  } finally {
    await client.close();
    await server.close();
    await bridge.close();
    await service.jobs.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);
