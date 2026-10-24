import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { fileURLToPath } from "node:url";

export async function verifyMcp(directory, send) {
  const isolated = await mkdtemp(join(tmpdir(), "forgecut-adapter-"));
  const adapter = join(isolated, "adapter.cjs");
  await cp(
    fileURLToPath(new URL("../dist/mcp-adapter.cjs", import.meta.url)),
    adapter,
  );
  const client = new Client({ name: "forgecut-smoke", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    cwd: tmpdir(),
    args: [adapter],
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
    const graphics = await client.callTool({
      name: "list_graphic_templates",
      arguments: { sessionId: snapshot.sessionId },
    });
    const title = graphics.structuredContent?.value?.templates?.find(
      (template) => template.template_id === "title-card",
    );
    if (
      graphics.isError ||
      title?.properties?.title?.type !== "text" ||
      !/^[a-f0-9]{64}$/.test(title.version)
    )
      throw new Error("Packaged graphic source metadata did not reach MCP");
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
    const path = join(isolated, "mcp-source.png");
    await writeFile(
      path,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const current = await client.callTool({
      name: "read_project",
      arguments: {},
    });
    const started = await client.callTool({
      name: "start_import",
      arguments: {
        sessionId: snapshot.sessionId,
        expectedRevision: current.structuredContent.value.revision,
        requestId: "smoke-import",
        paths: [path],
      },
    });
    if (started.isError) throw new Error(JSON.stringify(started));
    const jobId = started.structuredContent.value.id;
    let job;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const result = await client.callTool({
        name: "get_job",
        arguments: { sessionId: snapshot.sessionId, jobId },
      });
      if (result.isError) throw new Error(JSON.stringify(result));
      job = result.structuredContent.value;
      if (!["queued", "running", "committing"].includes(job.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (
      job?.status !== "completed" ||
      job.result?.value?.assetIds?.length !== 1
    )
      throw new Error(
        `Media import job did not complete: ${JSON.stringify(job)}`,
      );
    const assetVisible = await send("Runtime.evaluate", {
      expression: `(async () => {
        for (let attempt = 0; attempt < 100; attempt++) {
          if ([...document.querySelectorAll('.asset-name')].some(el => el.textContent === 'mcp-source.png')) return true;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        return false;
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (assetVisible.result?.result?.value !== true)
      throw new Error("Completed MCP import did not reach the asset bin");
    const latest = await client.callTool({
      name: "read_project",
      arguments: {},
    });
    const resourceImport = await client.callTool({
      name: "start_resource_import",
      arguments: {
        sessionId: snapshot.sessionId,
        expectedRevision: latest.structuredContent.value.revision,
        requestId: "smoke-resource",
        resource: {
          path,
          kind: "Image",
          license: { identifier: "test-only", text: "Generated smoke artwork" },
        },
      },
    });
    if (resourceImport.isError) throw new Error(JSON.stringify(resourceImport));
    const resourceJobId = resourceImport.structuredContent.value.id;
    let resourceJob;
    for (let attempt = 0; attempt < 150; attempt++) {
      const read = await client.callTool({
        name: "get_job",
        arguments: { sessionId: snapshot.sessionId, jobId: resourceJobId },
      });
      if (read.isError) throw new Error(JSON.stringify(read));
      resourceJob = read.structuredContent.value;
      if (!["queued", "running", "committing"].includes(resourceJob.status))
        break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (resourceJob?.status !== "completed")
      throw new Error(`Resource import failed: ${JSON.stringify(resourceJob)}`);
    const resources = await client.callTool({
      name: "read_graphic_resources",
      arguments: { sessionId: snapshot.sessionId },
    });
    if (
      resources.isError ||
      resources.structuredContent.value.resources[0]?.sha256?.length !== 64
    )
      throw new Error("Compiled MCP adapter did not discover imported artwork");
  } finally {
    await client.close();
    await transport.close();
    await rm(isolated, { recursive: true, force: true });
  }
}
