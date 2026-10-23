import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { fileURLToPath } from "node:url";

export async function verifyMcp(directory, send) {
  const client = new Client({ name: "forgecut-smoke", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    cwd: tmpdir(),
    args: [fileURLToPath(new URL("../dist/mcp-adapter.cjs", import.meta.url))],
    env: { ...process.env, FORGECUT_MCP_DIR: directory },
  });
  try {
    await client.connect(transport);
    const listing = await client.callTool({
      name: "list_sessions",
      arguments: {},
    });
    const instance = listing.structuredContent?.value?.[0];
    if (!instance || listing.structuredContent.value.length !== 1)
      throw new Error("Expected exactly one isolated Electron MCP session");
    const attached = await client.callTool({
      name: "attach_session",
      arguments: { instanceId: instance.instanceId },
    });
    const snapshot = attached.structuredContent?.value;
    if (attached.isError || !snapshot?.sessionId)
      throw new Error("Could not attach to the running editor");
    const edited = await client.callTool({
      name: "apply_edits",
      arguments: {
        sessionId: snapshot.sessionId,
        expectedRevision: snapshot.revision,
        requestId: "smoke-edit",
        label: "MCP smoke rename",
        operations: [
          { command: "update_project", args: { name: "MCP live editor" } },
        ],
      },
    });
    if (edited.isError) throw new Error(JSON.stringify(edited));
    const visible = await send("Runtime.evaluate", {
      expression: `(async () => {
      for (let i = 0; i < 100; i++) {
        if (document.querySelector('.project-name')?.textContent === 'MCP live editor') return true;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return false;
    })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (visible.result?.result?.value !== true)
      throw new Error("MCP edit did not reach the Electron renderer");
  } finally {
    await client.close();
    await transport.close();
  }
}
