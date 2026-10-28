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

it("pages source selections through MCP and preserves a manually edited note during an agent range change", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-picks-mcp-"));
  const state = new AppState();
  state.executeProjectChange((project) => {
    project.assets.push({
      id: "recording",
      name: "Recording",
      path: join(directory, "recording.mp4"),
      kind: "Video",
      probe: {
        duration_us: 10_000_000,
        width: 1920,
        height: 1080,
        fps: 30,
        codec: "h264",
        audio_channels: 2,
        audio_sample_rate: 48000,
      },
    });
  });
  const service = new EditingService(state);
  const bridge = await startLocalBridge(service, directory);
  const server = createMcpServer(directory);
  const client = new Client({ name: "source-picks", version: "1" });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(remote);
    await client.connect(local);
    await client.callTool({
      name: "attach_session",
      arguments: { instanceId: bridge.session.id },
    });
    const original = {
      assetId: "recording",
      name: "Opening",
      sourceInUs: 1_000_000,
      sourceOutUs: 3_000_000,
      notes: "Quiet start",
      rationale: "Establish the setting",
    };
    expect(
      (
        await client.callTool({
          name: "apply_edits",
          arguments: {
            sessionId: state.sessionId,
            expectedRevision: state.revision,
            requestId: "pick-opening",
            label: "Pick opening",
            operations: [{ command: "save_source_selection", args: original }],
          },
        })
      ).structuredContent,
    ).toMatchObject({ ok: true });
    const selectionId = state.project.source_selections![0].id;
    expect(
      await service.execute("save_source_selection", {
        ...original,
        selectionId,
        notes: "Keep the engine sound",
      }),
    ).toMatchObject({ ok: true });
    const read = await client.callTool({
      name: "read_source_selections",
      arguments: { sessionId: state.sessionId, assetId: "recording", limit: 1 },
    });
    expect(read.structuredContent).toMatchObject({
      ok: true,
      value: {
        revision: state.revision,
        total: 1,
        selections: [
          {
            id: selectionId,
            notes: "Keep the engine sound",
            source_in_us: 1_000_000,
          },
        ],
      },
    });
    expect(
      (
        await client.callTool({
          name: "read_source_selections",
          arguments: { sessionId: state.sessionId, offset: 1, limit: 1 },
        })
      ).structuredContent,
    ).toMatchObject({ ok: true, value: { total: 1, selections: [] } });
    const agent = {
      sessionId: state.sessionId,
      expectedRevision: state.revision,
      requestId: "trim-opening",
      label: "Trim opening",
      operations: [
        {
          command: "save_source_selection",
          args: {
            ...original,
            selectionId,
            sourceInUs: 1_500_000,
            notes: "Keep the engine sound",
          },
        },
      ],
    };
    expect(
      (await client.callTool({ name: "apply_edits", arguments: agent }))
        .structuredContent,
    ).toMatchObject({ ok: true });
    expect(state.project.source_selections![0]).toMatchObject({
      source_in_us: 1_500_000,
      notes: "Keep the engine sound",
    });
    const after = state.snapshot();
    expect(
      (await client.callTool({ name: "apply_edits", arguments: agent }))
        .structuredContent,
    ).toMatchObject({ ok: true });
    expect(state.snapshot()).toEqual(after);
    expect(
      (
        await client.callTool({
          name: "read_source_selections",
          arguments: { sessionId: "stale-project" },
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
