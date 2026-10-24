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

it("discovers graphic properties and preserves manual values while MCP edits a pinned instance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-graphics-mcp-"));
  const state = new AppState();
  const service = new EditingService(state);
  const bridge = await startLocalBridge(service, directory);
  const server = createMcpServer(directory);
  const client = new Client({ name: "graphics-test", version: "1" });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(remote);
    await client.connect(local);
    await client.callTool({
      name: "attach_session",
      arguments: { instanceId: bridge.session.id },
    });
    const templates = await client.callTool({
      name: "list_graphic_templates",
      arguments: { sessionId: state.sessionId },
    });
    expect(templates.structuredContent).toMatchObject({
      ok: true,
      value: {
        templates: [
          {
            template_id: "title-card",
            version: expect.any(String),
            properties: { title: { type: "text" } },
            layers: [
              { name: "artwork", kind: "image" },
              { name: "title", kind: "text" },
            ],
          },
        ],
      },
    });
    expect(JSON.stringify(templates.structuredContent)).not.toContain(
      "main.tsx",
    );
    const edit = await client.callTool({
      name: "apply_edits",
      arguments: {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        requestId: "graphic",
        label: "Add title",
        operations: [
          {
            command: "add_graphic_item",
            args: {
              templateId: "title-card",
              trackId: "graphics",
              timelineStartUs: 0,
              durationUs: 2000000,
              props: { title: "Octane" },
            },
          },
        ],
      },
    });
    expect(edit.isError).toBe(false);
    const item = state.project.timeline.tracks[0].items[0];
    if (!("RemotionGraphic" in item))
      throw new Error("Missing graphic instance");
    const graphic = item.RemotionGraphic;
    const component = await client.callTool({
      name: "read_graphic_component",
      arguments: {
        sessionId: state.sessionId,
        componentId: graphic.component_id,
        version: graphic.component_version,
      },
    });
    expect(component.structuredContent).toMatchObject({
      ok: true,
      value: {
        component: {
          id: graphic.component_id,
          version: graphic.component_version,
          properties: { title: { type: "text" } },
        },
      },
    });
    expect(
      await service.execute("update_item", {
        itemId: graphic.id,
        patch: {
          kind: "RemotionGraphic",
          changes: { props: { title: "Manual title" } },
        },
      }),
    ).toMatchObject({ ok: true });
    const afterManual = structuredClone(state.project);
    const changed = await client.callTool({
      name: "apply_edits",
      arguments: {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        requestId: "graphic-color",
        label: "Change title color",
        operations: [
          {
            command: "update_item",
            args: {
              itemId: graphic.id,
              patch: {
                kind: "RemotionGraphic",
                changes: { props: { color: "#a4c3b5" } },
              },
            },
          },
        ],
      },
    });
    expect(changed.isError).toBe(false);
    expect(
      await service.execute("get_item_details", { itemId: graphic.id }),
    ).toMatchObject({
      ok: true,
      value: {
        RemotionGraphic: {
          component_version: graphic.component_version,
          props: { title: "Manual title", color: "#a4c3b5" },
        },
      },
    });
    expect(
      (
        await client.callTool({
          name: "apply_history",
          arguments: {
            sessionId: state.sessionId,
            expectedRevision: state.revision,
            requestId: "undo-color",
            direction: "undo",
          },
        })
      ).isError,
    ).toBe(false);
    expect(state.project).toEqual(afterManual);
  } finally {
    await client.close();
    await server.close();
    await bridge.close();
    await rm(directory, { recursive: true, force: true });
  }
});
