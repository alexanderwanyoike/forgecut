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

it("pages project style identities and instantiates them through guarded MCP edits without replaying a retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-styles-mcp-"));
  const state = new AppState();
  const service = new EditingService(state);
  const bridge = await startLocalBridge(service, directory);
  const server = createMcpServer(directory);
  const client = new Client({ name: "project-styles", version: "1" });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  try {
    await service.execute("add_graphic_item", {
      templateId: "title-card",
      trackId: "graphics",
      timelineStartUs: 0,
      durationUs: 1000000,
      props: { color: "#8293a4" },
    });
    const source = state.project.timeline.tracks[0].items[0];
    if (!("RemotionGraphic" in source)) throw new Error("Missing card");
    await server.connect(remote);
    await client.connect(local);
    await client.callTool({
      name: "attach_session",
      arguments: { instanceId: bridge.session.id },
    });
    for (const name of ["Project card", "Project ending"]) {
      expect(
        (
          await client.callTool({
            name: "apply_edits",
            arguments: {
              sessionId: state.sessionId,
              expectedRevision: state.revision,
              requestId: name.replaceAll(" ", "-"),
              label: "Save project style",
              operations: [
                {
                  command: "save_style_preset",
                  args: {
                    sourceSequenceId: state.project.default_sequence!.id,
                    itemId: source.RemotionGraphic.id,
                    name,
                    purpose: name.endsWith("ending") ? "ending" : "card",
                  },
                },
              ],
            },
          })
        ).structuredContent,
      ).toMatchObject({ ok: true });
    }
    const page = await client.callTool({
      name: "read_style_presets",
      arguments: { sessionId: state.sessionId, offset: 0, limit: 1 },
    });
    expect(page.structuredContent).toMatchObject({
      ok: true,
      value: {
        total: 2,
        presets: [
          {
            name: "Project card",
            purpose: "card",
            component_version: source.RemotionGraphic.component_version,
          },
        ],
      },
    });
    const preset = state.project.style_presets![0];
    expect(
      (page.structuredContent as { value: { presets: unknown[] } }).value
        .presets,
    ).toEqual([
      {
        id: preset.id,
        name: preset.name,
        purpose: preset.purpose,
        canvas_size: preset.canvas_size,
        component_id: preset.component_id,
        component_version: preset.component_version,
      },
    ]);
    expect(
      (
        await client.callTool({
          name: "read_style_presets",
          arguments: { sessionId: state.sessionId, offset: 1, limit: 1 },
        })
      ).structuredContent,
    ).toMatchObject({
      ok: true,
      value: { total: 2, presets: [{ name: "Project ending" }] },
    });
    const values: Record<string, unknown> = {};
    for (
      let offset = 0;
      offset < Object.keys(preset.props).length;
      offset += 5
    ) {
      const detail = await client.callTool({
        name: "read_style_preset",
        arguments: {
          sessionId: state.sessionId,
          presetId: preset.id,
          offset,
          limit: 5,
        },
      });
      expect(detail.structuredContent).toMatchObject({
        ok: true,
        value: { presetId: preset.id, total: Object.keys(preset.props).length },
      });
      const pageValues = (
        detail.structuredContent as {
          value: { props: Record<string, unknown> };
        }
      ).value.props;
      expect(Object.keys(pageValues).length).toBeLessThanOrEqual(5);
      Object.assign(values, pageValues);
    }
    expect(values).toEqual(preset.props);
    expect(
      (
        await client.callTool({
          name: "read_style_preset",
          arguments: {
            sessionId: state.sessionId,
            presetId: preset.id,
            limit: 6,
          },
        })
      ).isError,
    ).toBe(true);
    await service.execute("update_item", {
      itemId: source.RemotionGraphic.id,
      patch: {
        kind: "RemotionGraphic",
        changes: { props: { color: "#555555" } },
      },
    });
    const before = state.snapshot();
    const request = {
      sessionId: state.sessionId,
      sequenceId: state.project.default_sequence!.id,
      expectedRevision: state.revision,
      requestId: "add-styled-card",
      label: "Add styled card",
      operations: [
        {
          command: "add_graphic_from_preset",
          args: {
            presetId: preset.id,
            trackId: "graphics",
            timelineStartUs: 2000000,
            durationUs: 1000000,
            overrides: { title: "Agent wording" },
          },
        },
      ],
    };
    expect(
      (await client.callTool({ name: "apply_edits", arguments: request }))
        .structuredContent,
    ).toMatchObject({ ok: true });
    expect(state.project.timeline.tracks[0].items[1]).toMatchObject({
      RemotionGraphic: { props: { title: "Agent wording", color: "#8293a4" } },
    });
    const after = state.snapshot();
    expect(
      (await client.callTool({ name: "apply_edits", arguments: request }))
        .structuredContent,
    ).toMatchObject({ ok: true });
    expect(state.snapshot()).toEqual(after);
    expect(
      (
        await client.callTool({
          name: "apply_history",
          arguments: {
            sessionId: state.sessionId,
            sequenceId: state.project.default_sequence!.id,
            expectedRevision: state.revision,
            requestId: "undo-styled-card",
            direction: "undo",
          },
        })
      ).structuredContent,
    ).toMatchObject({ ok: true });
    expect(state.project).toEqual(before.project);
    expect(
      (
        await client.callTool({
          name: "read_style_presets",
          arguments: { sessionId: "stale-session" },
        })
      ).structuredContent,
    ).toMatchObject({ ok: false, error: { code: "PROJECT_CHANGED" } });
  } finally {
    await client.close();
    await server.close();
    await bridge.close();
    await service.jobs.close();
    await service.closePreviews();
    await rm(directory, { recursive: true, force: true });
  }
});
