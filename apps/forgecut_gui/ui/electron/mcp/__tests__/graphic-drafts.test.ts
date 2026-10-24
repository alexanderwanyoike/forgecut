/** @vitest-environment node */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, vi } from "vitest";
import { AppState } from "../../backend/state";
import { EditingService } from "../../backend/editing-service";
import { GraphicPreviewService } from "../../backend/GraphicPreviewService";
import type { GraphicDraft } from "../../shared/graphic-draft";
import { startLocalBridge } from "../local-bridge";
import { createMcpServer } from "../server";
it("reads bounded source, detects manual draft conflicts and applies through the shared guarded job", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-mcp-drafts-"));
  vi.stubEnv("FORGECUT_DRAFT_DIR", join(directory, "drafts"));
  const state = new AppState();
  const service = new EditingService(state);
  vi.spyOn(GraphicPreviewService.prototype, "render").mockResolvedValue({
    ok: true,
    value: { mimeType: "image/png", data: "AA==", width: 64, height: 36 },
  });
  const bridge = await startLocalBridge(service, directory);
  const server = createMcpServer(directory);
  const client = new Client({ name: "draft-workflow", version: "1" });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  try {
    await service.execute("add_graphic_item", {
      templateId: "title-card",
      trackId: "graphics",
      timelineStartUs: 0,
      durationUs: 1000000,
      props: { title: "Manual wording" },
    });
    const item = state.project.timeline.tracks[0].items[0];
    if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
    const itemId = item.RemotionGraphic.id;
    await server.connect(remote);
    await client.connect(local);
    await client.callTool({
      name: "attach_session",
      arguments: { instanceId: bridge.session.id },
    });
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "read_graphic_source",
        "patch_graphic_draft_file",
        "save_graphic_draft",
        "revert_graphic_draft",
        "start_graphic_promotion",
      ]),
    );
    const target = { itemId, sessionId: state.sessionId };
    const source = await client.callTool({
      name: "read_graphic_source",
      arguments: target,
    });
    expect(source.structuredContent).toMatchObject({
      ok: true,
      value: { draftRevision: 0, files: expect.any(Array) },
    });
    expect(JSON.stringify(source.structuredContent)).not.toContain(
      "export default",
    );
    expect(
      (
        await client.callTool({
          name: "read_graphic_source",
          arguments: { ...target, sessionId: randomUUID() },
        })
      ).structuredContent,
    ).toMatchObject({ ok: false, error: { code: "PROJECT_CHANGED" } });
    const draft = await service.execute("get_graphic_draft", { itemId });
    if (!draft.ok) throw new Error(draft.error.message);
    const original = draft.value as GraphicDraft;
    original.component.properties.title.label = "Manual title label";
    const file = original.component.source.entry;
    const fetched = await client.callTool({
      name: "read_graphic_source",
      arguments: { ...target, file },
    });
    expect(fetched.structuredContent).toMatchObject({
      ok: true,
      value: {
        file: { path: file, content: original.component.source.files[file] },
      },
    });
    expect(
      await service.execute("save_graphic_draft", {
        ...target,
        expectedDraftRevision: 0,
        baseVersion: original.baseVersion,
        component: original.component,
      }),
    ).toMatchObject({ ok: true });
    expect(
      (
        await client.callTool({
          name: "read_graphic_source",
          arguments: { ...target, includeMetadata: true },
        })
      ).structuredContent,
    ).toMatchObject({
      ok: true,
      value: {
        metadata: { properties: { title: { label: "Manual title label" } } },
      },
    });
    const patch = {
      ...target,
      baseVersion: original.baseVersion,
      expectedDraftRevision: 0,
      path: file,
      content: "export default function Card(){return <div/>}",
    };
    expect(
      (
        await client.callTool({
          name: "patch_graphic_draft_file",
          arguments: patch,
        })
      ).structuredContent,
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    const before = state.snapshot();
    expect(
      (
        await client.callTool({
          name: "patch_graphic_draft_file",
          arguments: { ...patch, expectedDraftRevision: 1 },
        })
      ).structuredContent,
    ).toMatchObject({ ok: true, value: { draftRevision: 2 } });
    expect(state.snapshot()).toEqual(before);
    const request = {
      ...target,
      expectedRevision: state.revision,
      expectedDraftRevision: 2,
      requestId: randomUUID(),
    };
    const started = await client.callTool({
      name: "start_graphic_promotion",
      arguments: request,
    });
    expect(started.structuredContent).toMatchObject({
      ok: true,
      value: { kind: "compile" },
    });
    const job = (started.structuredContent as { value: { id: string } }).value;
    await vi.waitFor(async () =>
      expect(
        (
          await client.callTool({
            name: "get_job",
            arguments: { sessionId: state.sessionId, jobId: job.id },
          })
        ).structuredContent,
      ).toMatchObject({
        ok: true,
        value: { status: "completed", result: { ok: true } },
      }),
    );
    const active = await client.callTool({
      name: "read_graphic_source",
      arguments: { ...target, view: "active", file },
    });
    expect(active.structuredContent).toMatchObject({
      ok: true,
      value: { file: { content: patch.content } },
    });
    await writeFile(
      join(directory, "drafts", `${state.project.id}-${itemId}.json`),
      "corrupt draft",
    );
    expect(
      (
        await client.callTool({
          name: "read_graphic_source",
          arguments: { ...target, view: "active", file },
        })
      ).structuredContent,
    ).toMatchObject({
      ok: true,
      value: { draftRevision: null, file: { content: patch.content } },
    });
    expect(
      (
        await client.callTool({
          name: "start_graphic_promotion",
          arguments: request,
        })
      ).structuredContent,
    ).toMatchObject({ ok: true, value: { id: job.id } });
  } finally {
    await client.close();
    await server.close();
    await bridge.close();
    await service.jobs.close();
    await service.closeGraphicsPreview();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);
