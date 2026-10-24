/** @vitest-environment node */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, expect, it, vi } from "vitest";
import { AppState } from "../../backend/state";
import { EditingService } from "../../backend/editing-service";
import { startLocalBridge } from "../local-bridge";
import { createMcpServer } from "../server";

afterEach(() => vi.unstubAllEnvs());
it("imports, discovers and selects a font through an idempotent MCP job while preserving manual text", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-resource-mcp-"));
  vi.stubEnv("FORGECUT_RESOURCE_DIR", join(directory, "cache"));
  const state = new AppState();
  const service = new EditingService(state);
  const bridge = await startLocalBridge(service, directory);
  const server = createMcpServer(directory);
  const client = new Client({ name: "resource-test", version: "1" });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  try {
    const path = join(directory, "fixture.ttf");
    await writeFile(path, Buffer.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    await service.execute("add_graphic_item", {
      templateId: "title-card",
      trackId: "graphics",
      timelineStartUs: 0,
      durationUs: 1000000,
      props: { title: "Manual wording" },
    });
    const item = state.project.timeline.tracks[0].items[0];
    if (!("RemotionGraphic" in item)) throw new Error("Invalid fixture");
    const before = structuredClone(state.project);
    await server.connect(remote);
    await client.connect(local);
    await client.callTool({
      name: "attach_session",
      arguments: { instanceId: bridge.session.id },
    });
    const request = {
      sessionId: state.sessionId,
      expectedRevision: state.revision,
      requestId: "import-font",
      resource: {
        path,
        kind: "Font",
        license: {
          identifier: "test-only",
          text: "Generated transport fixture",
        },
        target: { itemId: item.RemotionGraphic.id, property: "font" },
      },
    };
    const started = await client.callTool({
      name: "start_resource_import",
      arguments: request,
    });
    expect(started.isError).toBe(false);
    const jobId = (started.structuredContent as { value: { id: string } }).value
      .id;
    let job: unknown;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      job = (
        await client.callTool({
          name: "get_job",
          arguments: { sessionId: state.sessionId, jobId },
        })
      ).structuredContent;
      if ((job as { value: { status: string } }).value.status === "completed")
        break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(job).toMatchObject({
      ok: true,
      value: {
        status: "completed",
        result: { ok: true, value: { resourceId: expect.any(String) } },
      },
    });
    const resource = state.project.resources![0];
    expect(state.project.timeline.tracks[0].items[0]).toMatchObject({
      RemotionGraphic: {
        props: { title: "Manual wording", font: resource.id },
      },
    });
    const retry = await client.callTool({
      name: "start_resource_import",
      arguments: request,
    });
    expect(retry.structuredContent).toMatchObject({
      ok: true,
      value: { id: jobId },
    });
    const listing = await client.callTool({
      name: "read_graphic_resources",
      arguments: { sessionId: state.sessionId },
    });
    expect(listing.structuredContent).toMatchObject({
      ok: true,
      value: {
        resources: [
          {
            id: resource.id,
            kind: "Font",
            license: { identifier: "test-only" },
          },
        ],
        total: 1,
      },
    });
    expect(JSON.stringify(listing.structuredContent)).not.toContain(
      "Generated transport fixture",
    );
    const details = await client.callTool({
      name: "read_graphic_resource",
      arguments: { sessionId: state.sessionId, resourceId: resource.id },
    });
    expect(details.structuredContent).toMatchObject({
      ok: true,
      value: { resource: { license: { text: "Generated transport fixture" } } },
    });
    await client.callTool({
      name: "apply_history",
      arguments: {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        requestId: "undo-font",
        direction: "undo",
      },
    });
    expect(state.project).toEqual(before);
  } finally {
    await client.close();
    await server.close();
    await bridge.close();
    await service.jobs.close();
    await rm(directory, { recursive: true, force: true });
  }
});
