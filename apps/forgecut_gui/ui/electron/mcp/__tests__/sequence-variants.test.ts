/** @vitest-environment node */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { AppState } from "../../backend/state";
import { EditingService } from "../../backend/editing-service";
import { itemData } from "../../domain/timeline-item";
import { startLocalBridge } from "../local-bridge";
import { createMcpServer } from "../server";

it("discovers variant origins and syncs timing through MCP while retaining manual wording", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-variant-mcp-"));
  const state = new AppState();
  const service = new EditingService(state);
  const bridge = await startLocalBridge(service, directory);
  const server = createMcpServer(directory);
  const client = new Client({ name: "variants", version: "1" });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  try {
    expect(
      await service.execute("add_text_overlay", {
        trackId: "titles",
        timelineStartUs: 0,
        durationUs: 1000000,
        text: "Original",
        fontSize: 24,
        color: "#ffffff",
        x: 10,
        y: 10,
      }),
    ).toMatchObject({ ok: true });
    const root = state.project.default_sequence!.id;
    const sourceItem = itemData(state.project.timeline.tracks[0].items[0]);
    await server.connect(remote);
    await client.connect(local);
    await client.callTool({
      name: "attach_session",
      arguments: { instanceId: bridge.session.id },
    });
    const copy = await client.callTool({
      name: "apply_edits",
      arguments: {
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        requestId: "portrait-copy",
        label: "Make portrait variant",
        operations: [
          {
            command: "create_sequence_variant",
            args: {
              sourceSequenceId: root,
              name: "Portrait",
              settings: { width: 360, height: 640 },
            },
          },
        ],
      },
    });
    expect(copy.structuredContent).toMatchObject({ ok: true });
    const variant = state.project.sequences![0];
    const targetItem = itemData(variant.timeline.tracks[0].items[0]);
    expect(
      (
        await client.callTool({
          name: "read_sequences",
          arguments: { sessionId: state.sessionId, offset: 1, limit: 1 },
        })
      ).structuredContent,
    ).toMatchObject({
      ok: true,
      value: { sequences: [{ id: variant.id, variantSourceSequenceId: root }] },
    });
    expect(
      (
        await client.callTool({
          name: "read_item",
          arguments: { sessionId: state.sessionId, itemId: targetItem.id },
        })
      ).structuredContent,
    ).toMatchObject({
      ok: true,
      value: {
        sequenceId: variant.id,
        item: { TextOverlay: { origin_item_id: sourceItem.id } },
      },
    });
    expect(
      await service.execute(
        "update_item",
        {
          itemId: targetItem.id,
          patch: {
            kind: "TextOverlay",
            changes: { text: "My manual wording" },
          },
        },
        { sessionId: state.sessionId, sequenceId: variant.id },
      ),
    ).toMatchObject({ ok: true });
    expect(
      await service.execute(
        "move_clip",
        { itemId: sourceItem.id, newStartUs: 2000000 },
        { sessionId: state.sessionId, sequenceId: root },
      ),
    ).toMatchObject({ ok: true });
    expect(
      itemData(state.project.sequences![0].timeline.tracks[0].items[0])
        .timeline_start_us,
    ).toBe(0);
    expect(
      (
        await client.callTool({
          name: "apply_edits",
          arguments: {
            sessionId: state.sessionId,
            expectedRevision: state.revision,
            requestId: "timing-only",
            label: "Sync portrait timing",
            sequenceId: variant.id,
            operations: [
              {
                command: "sync_variant_timing",
                args: { itemIds: [targetItem.id] },
              },
            ],
          },
        })
      ).structuredContent,
    ).toMatchObject({ ok: true });
    expect(
      state.project.sequences![0].timeline.tracks[0].items[0],
    ).toMatchObject({
      TextOverlay: {
        text: "My manual wording",
        timeline_start_us: 2000000,
        origin_item_id: sourceItem.id,
      },
    });
    expect(state.getEditingContext().activeSequenceId).toBe(root);
  } finally {
    await client.close();
    await server.close();
    await bridge.close();
    await service.jobs.close();
    await service.closeGraphicsPreview();
    await rm(directory, { recursive: true, force: true });
  }
});
