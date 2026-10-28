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

it("reads bounded asset credit details and updates them through guarded MCP history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-credits-mcp-"));
  const state = new AppState();
  const license = {
    identifier: "\0".repeat(256),
    text: "\0".repeat(65536),
    attribution: "\0".repeat(2048),
    source_url: "https://example.com/recording",
  };
  state.executeProjectChange((project) => {
    for (let index = 0; index < 100; index += 1)
      project.assets.push({
        id: `recording-${index}`,
        name: "Recording",
        path: "/recording.mkv",
        kind: "Video",
        probe: null,
        license,
      });
  });
  const service = new EditingService(state);
  const bridge = await startLocalBridge(service, directory);
  const server = createMcpServer(directory);
  const client = new Client({ name: "project-credits", version: "1" });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(remote);
    await client.connect(local);
    await client.callTool({
      name: "attach_session",
      arguments: { instanceId: bridge.session.id },
    });
    const detail = await client.callTool({
      name: "read_asset_credit",
      arguments: { sessionId: state.sessionId, assetId: "recording-0" },
    });
    expect(detail.structuredContent).toMatchObject({
      ok: true,
      value: {
        sessionId: state.sessionId,
        revision: state.revision,
        assetId: "recording-0",
        license,
      },
    });
    const page = await client.callTool({
      name: "read_assets",
      arguments: { sessionId: state.sessionId, limit: 100 },
    });
    expect(page.structuredContent).toMatchObject({
      ok: true,
      value: {
        total: 100,
        assets: [
          {
            license: {
              identifier: license.identifier,
            },
          },
          ...Array.from({ length: 99 }, () => ({})),
        ],
      },
    });
    expect(
      (page.structuredContent as { value: { assets: { license: unknown }[] } })
        .value.assets[0].license,
    ).toEqual({ identifier: license.identifier });
    expect(JSON.stringify(page.structuredContent)).not.toContain('"text":');
    expect(
      Buffer.byteLength(JSON.stringify(detail.structuredContent)),
    ).toBeLessThan(1024 * 1024);
    expect(
      Buffer.byteLength(JSON.stringify(page.structuredContent)),
    ).toBeLessThan(1024 * 1024);
    state.executeProjectChange((project) => {
      for (const asset of project.assets.slice(1)) delete asset.license;
    });
    const before = state.snapshot();
    const request = {
      sessionId: state.sessionId,
      expectedRevision: state.revision,
      requestId: "manual-credit",
      label: "Update recording credit",
      operations: [
        {
          command: "set_asset_license",
          args: {
            assetId: "recording-0",
            license: {
              identifier: "Recording",
              text: "Supplied by the editor",
              attribution: "Manual credit",
            },
          },
        },
      ],
    };
    expect(
      (await client.callTool({ name: "apply_edits", arguments: request }))
        .structuredContent,
    ).toMatchObject({ ok: true });
    const after = state.snapshot();
    expect(
      (await client.callTool({ name: "apply_edits", arguments: request }))
        .structuredContent,
    ).toMatchObject({ ok: true });
    expect(state.snapshot()).toEqual(after);
    expect(
      (
        await client.callTool({
          name: "apply_edits",
          arguments: { ...request, requestId: "stale-credit" },
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
            requestId: "undo-credit",
            direction: "undo",
          },
        })
      ).structuredContent,
    ).toMatchObject({ ok: true });
    expect(state.project).toEqual(before.project);
    expect(
      (
        await client.callTool({
          name: "read_asset_credit",
          arguments: { sessionId: state.sessionId, assetId: "missing" },
        })
      ).structuredContent,
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(
      (
        await client.callTool({
          name: "read_asset_credit",
          arguments: { sessionId: "stale", assetId: "recording-0" },
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
