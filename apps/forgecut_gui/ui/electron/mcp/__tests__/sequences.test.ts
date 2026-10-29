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

it("reads and edits explicit sequences while preserving manual work and guarding context selection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-sequence-mcp-"));
  const state = new AppState();
  const service = new EditingService(state);
  const bridge = await startLocalBridge(service, directory);
  const server = createMcpServer(directory);
  const client = new Client({ name: "sequences", version: "1" });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  const text = (trackId: string, value: string) => ({
    trackId,
    timelineStartUs: 0,
    durationUs: 1000000,
    text: value,
    fontSize: 24,
    color: "#ffffff",
    x: 20,
    y: 20,
  });
  try {
    await service.execute("add_text_overlay", text("root-text", "Root"));
    await server.connect(remote);
    await client.connect(local);
    await client.callTool({
      name: "attach_session",
      arguments: { instanceId: bridge.session.id },
    });
    expect(
      (
        await client.callTool({
          name: "apply_edits",
          arguments: {
            sessionId: state.sessionId,
            expectedRevision: state.revision,
            requestId: "create-clip",
            label: "Create portrait clip",
            operations: [
              {
                command: "create_sequence",
                args: {
                  name: "Portrait",
                  settings: { width: 360, height: 640, fps: 10 },
                },
              },
            ],
          },
        })
      ).structuredContent,
    ).toMatchObject({ ok: true });
    const root = state.project.default_sequence!.id;
    const clip = state.project.sequences![0].id;
    const listed = await client.callTool({
      name: "read_sequences",
      arguments: { sessionId: state.sessionId, offset: 1, limit: 1 },
    });
    expect(listed.structuredContent).toMatchObject({
      ok: true,
      value: {
        total: 2,
        activeSequenceId: root,
        defaultSequenceId: root,
        sequences: [
          { id: clip, name: "Portrait", settings: { width: 360, height: 640 } },
        ],
      },
    });
    expect(
      (await client.callTool({ name: "read_project", arguments: {} }))
        .structuredContent,
    ).toMatchObject({
      ok: true,
      value: {
        sequenceCount: 2,
        activeSequenceId: root,
        defaultSequenceId: root,
      },
    });
    expect(
      (
        await client.callTool({
          name: "apply_edits",
          arguments: {
            sessionId: state.sessionId,
            expectedRevision: state.revision,
            requestId: "assemble-clip",
            label: "Assemble clip",
            sequenceId: clip,
            operations: [
              { command: "add_text_overlay", args: text("clip-text", "Clip") },
            ],
          },
        })
      ).structuredContent,
    ).toMatchObject({ ok: true });
    const clipItem = state.project.sequences![0].timeline.tracks[0].items[0];
    if (!("TextOverlay" in clipItem) || !clipItem.TextOverlay)
      throw new Error("Missing clip title");
    const range = {
      sessionId: state.sessionId,
      startUs: 0,
      endUs: 1000000,
      offset: 0,
      limit: 1,
    };
    expect(
      (
        await client.callTool({
          name: "read_timeline",
          arguments: { ...range, sequenceId: clip },
        })
      ).structuredContent,
    ).toMatchObject({
      ok: true,
      value: {
        sequenceId: clip,
        total: 1,
        items: [{ TextOverlay: { text: "Clip" } }],
      },
    });
    expect(
      (await client.callTool({ name: "read_timeline", arguments: range }))
        .structuredContent,
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(
      (
        await client.callTool({
          name: "read_sequence_frame",
          arguments: {
            sessionId: state.sessionId,
            sequenceId: clip,
            playheadUs: 0,
          },
        })
      ).structuredContent,
    ).toMatchObject({
      ok: true,
      value: {
        sequenceId: clip,
        frameCount: 10,
        settings: { width: 360, height: 640, fps: 10 },
      },
    });
    expect(
      (
        await client.callTool({
          name: "read_item",
          arguments: {
            sessionId: state.sessionId,
            itemId: clipItem.TextOverlay.id,
          },
        })
      ).structuredContent,
    ).toMatchObject({
      ok: true,
      value: { sequenceId: clip, item: { TextOverlay: { text: "Clip" } } },
    });
    const rootItem = state.project.timeline.tracks[0].items[0];
    if (!("TextOverlay" in rootItem) || !rootItem.TextOverlay)
      throw new Error("Missing root title");
    await service.execute(
      "update_item",
      {
        itemId: rootItem.TextOverlay.id,
        patch: {
          kind: "TextOverlay",
          changes: { text: "Manual Root wording" },
        },
      },
      { sessionId: state.sessionId, sequenceId: root },
    );
    const manual = structuredClone(state.project.timeline);
    expect(
      (
        await client.callTool({
          name: "apply_edits",
          arguments: {
            sessionId: state.sessionId,
            expectedRevision: state.revision,
            requestId: "refine-clip",
            label: "Refine clip",
            sequenceId: clip,
            operations: [
              {
                command: "update_item",
                args: {
                  itemId: clipItem.TextOverlay.id,
                  patch: {
                    kind: "TextOverlay",
                    changes: { text: "Agent clip wording" },
                  },
                },
              },
            ],
          },
        })
      ).structuredContent,
    ).toMatchObject({ ok: true });
    expect(state.project.timeline).toEqual(manual);
    expect(state.getEditingContext().activeSequenceId).toBe(root);
    const activation = state.getEditingContext().sequenceRevision;
    const revision = state.revision;
    expect(
      (
        await client.callTool({
          name: "select_sequence",
          arguments: {
            sessionId: state.sessionId,
            sequenceId: clip,
            expectedSequenceRevision: activation,
          },
        })
      ).structuredContent,
    ).toMatchObject({ ok: true, value: { activeSequenceId: clip } });
    expect(state.revision).toBe(revision);
    expect(
      (
        await client.callTool({
          name: "select_sequence",
          arguments: {
            sessionId: state.sessionId,
            sequenceId: root,
            expectedSequenceRevision: activation,
          },
        })
      ).structuredContent,
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(
      (
        await client.callTool({
          name: "apply_history",
          arguments: {
            sessionId: state.sessionId,
            expectedRevision: state.revision,
            requestId: "undo-clip",
            direction: "undo",
            sequenceId: clip,
          },
        })
      ).structuredContent,
    ).toMatchObject({ ok: true });
    expect(state.project.timeline).toEqual(manual);
    expect(
      state.project.sequences![0].timeline.tracks[0].items[0],
    ).toMatchObject({ TextOverlay: { text: "Clip" } });
    const before = structuredClone(state.project);
    const path = join(directory, "sequences.forgecut");
    expect(
      (
        await client.callTool({
          name: "save_project",
          arguments: {
            sessionId: state.sessionId,
            expectedRevision: state.revision,
            path,
          },
        })
      ).structuredContent,
    ).toMatchObject({ ok: true });
    expect(
      (
        await client.callTool({
          name: "open_project",
          arguments: {
            sessionId: state.sessionId,
            expectedRevision: state.revision,
            path,
          },
        })
      ).structuredContent,
    ).toMatchObject({ ok: true });
    expect(state.project).toEqual(before);
  } finally {
    await client.close();
    await server.close();
    await bridge.close();
    await service.jobs.close();
    await service.closePreviews();
    await rm(directory, { recursive: true, force: true });
  }
});
