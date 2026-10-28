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

it("patches a source range without replacing manual notes and rejects invalid patches atomically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-source-patch-"));
  const state = new AppState();
  state.executeProjectChange((project) => {
    project.assets.push({
      id: "recording",
      name: "Recording",
      path: join(directory, "recording.mp4"),
      kind: "Video",
      probe: {
        duration_us: 10000000,
        width: 640,
        height: 360,
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
  const client = new Client({ name: "source-patches", version: "1" });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  try {
    expect(
      await service.execute("save_source_selection", {
        assetId: "recording",
        name: "Opening",
        sourceInUs: 1000000,
        sourceOutUs: 3000000,
        notes: "Initial note",
        rationale: "Establishes the setting",
      }),
    ).toMatchObject({ ok: true });
    const selectionId = state.project.source_selections![0].id;
    expect(
      await service.execute("update_source_selection", {
        selectionId,
        patch: { notes: "Keep the engine sound" },
      }),
    ).toMatchObject({ ok: true });
    await server.connect(remote);
    await client.connect(local);
    await client.callTool({
      name: "attach_session",
      arguments: { instanceId: bridge.session.id },
    });
    const beforeAgent = state.snapshot();
    const request = {
      sessionId: state.sessionId,
      expectedRevision: state.revision,
      requestId: "agent-range",
      label: "Trim opening",
      operations: [
        {
          command: "update_source_selection",
          args: { selectionId, patch: { source_in_us: 1500000 } },
        },
      ],
    };
    expect(
      (await client.callTool({ name: "apply_edits", arguments: request }))
        .structuredContent,
    ).toMatchObject({ ok: true });
    expect(state.project.source_selections![0]).toMatchObject({
      source_in_us: 1500000,
      source_out_us: 3000000,
      notes: "Keep the engine sound",
      rationale: "Establishes the setting",
    });
    const after = state.snapshot();
    expect(
      (await client.callTool({ name: "apply_edits", arguments: request }))
        .structuredContent,
    ).toMatchObject({ ok: true });
    expect(state.snapshot()).toEqual(after);
    expect(
      await service.execute("update_source_selection", {
        selectionId,
        patch: { source_out_us: 500000 },
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(state.snapshot()).toEqual(after);
    expect(
      await service.execute("update_source_selection", {
        selectionId,
        patch: {},
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(
      await service.execute("update_source_selection", {
        selectionId: "missing",
        patch: { notes: "No" },
      }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await service.execute("undo")).toMatchObject({ ok: true });
    expect(state.project).toEqual(beforeAgent.project);
  } finally {
    await client.close();
    await server.close();
    await bridge.close();
    await service.jobs.close();
    await service.closePreviews();
    await rm(directory, { recursive: true, force: true });
  }
});
