/** @vitest-environment node */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { AppState } from "../../backend/state";
import { EditingService } from "../../backend/editing-service";
import { startLocalBridge } from "../local-bridge";
import { createMcpServer } from "../server";

it("requires explicit attachment and edits the live owner through the official MCP SDK", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-mcp-"));
  const state = new AppState();
  const bridge = await startLocalBridge(new EditingService(state), directory);
  const server = createMcpServer(directory);
  const client = new Client({ name: "editor-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const capabilities = await client.callTool({
      name: "get_capabilities",
      arguments: {},
    });
    expect(capabilities.structuredContent).toMatchObject({
      ok: true,
      value: {
        timeUnit: "microseconds",
        operations: {
          trim_clip: {
            type: "object",
            properties: { newUs: { type: "integer" } },
          },
        },
      },
    });
    expect(
      (await client.callTool({ name: "read_project", arguments: {} })).isError,
    ).toBe(true);
    const listing = await client.callTool({
      name: "list_sessions",
      arguments: {},
    });
    expect(JSON.stringify(listing)).toContain(bridge.session.id);
    expect(JSON.stringify(listing)).not.toContain(bridge.session.secret);
    expect(
      (
        await client.callTool({
          name: "attach_session",
          arguments: { instanceId: bridge.session.id },
        })
      ).isError,
    ).toBe(false);
    const edit = await client.callTool({
      name: "apply_edits",
      arguments: {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        requestId: "rename",
        label: "Rename project",
        operations: [
          { command: "update_project", args: { name: "From Codex" } },
        ],
      },
    });
    expect(edit.isError).toBe(false);
    expect(state.project.name).toBe("From Codex");
    const history = await client.callTool({
      name: "apply_history",
      arguments: {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        requestId: "undo-rename",
        direction: "undo",
      },
    });
    expect(history.isError).toBe(false);
    expect(state.project.name).toBe("Untitled");
    const redone = await client.callTool({
      name: "apply_history",
      arguments: {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        requestId: "redo-rename",
        direction: "redo",
      },
    });
    expect(redone.isError).toBe(false);
    expect(state.project.name).toBe("From Codex");
    const current = await client.callTool({
      name: "read_project",
      arguments: {},
    });
    expect(current.structuredContent).toMatchObject({
      ok: true,
      value: { name: "From Codex", revision: state.revision },
    });
    const path = join(directory, "saved.forgecut");
    const saved = await client.callTool({
      name: "save_project",
      arguments: {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        path,
      },
    });
    expect(saved.isError).toBe(false);
    state.executeProjectChange((project) => {
      project.name = "Unsaved change";
    });
    const previousSession = state.sessionId;
    const reopened = await client.callTool({
      name: "open_project",
      arguments: {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        path,
      },
    });
    expect(reopened.isError).toBe(false);
    expect(state.project.name).toBe("From Codex");
    expect(state.sessionId).not.toBe(previousSession);
    const unchanged = state.snapshot();
    expect(
      (
        await client.callTool({
          name: "open_project",
          arguments: {
            sessionId: state.sessionId,
            expectedRevision: state.revision,
            path: join(directory, "missing.forgecut"),
          },
        })
      ).isError,
    ).toBe(true);
    expect(state.snapshot()).toEqual(unchanged);
  } finally {
    await client.close();
    await server.close();
    await bridge.close();
    await rm(directory, { recursive: true, force: true });
  }
});
