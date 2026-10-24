/** @vitest-environment node */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { GraphicPreviewService } from "../GraphicPreviewService";
import type { GraphicDraft } from "../../shared/graphic-draft";
import type { JobSnapshot } from "../../shared/jobs";
const frame = {
  ok: true as const,
  value: {
    mimeType: "image/png" as const,
    data: "AA==",
    width: 64,
    height: 36,
  },
};
let directory: string;
const services: EditingService[] = [];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "forgecut-promotion-"));
  vi.stubEnv("FORGECUT_DRAFT_DIR", directory);
  vi.spyOn(GraphicPreviewService.prototype, "render").mockResolvedValue(frame);
});
afterEach(async () => {
  for (const service of services.splice(0)) {
    await service.jobs.close();
    await service.closeGraphicsPreview();
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const state = new AppState();
  const service = new EditingService(state);
  services.push(service);
  for (let index = 0; index < 2; index += 1)
    await service.execute("add_graphic_item", {
      templateId: "title-card",
      trackId: "graphics",
      timelineStartUs: index * 2000000,
      durationUs: 1000000,
      props: { title: `Card ${index}`, title_x: 300 + index },
    });
  const items = state.project.timeline.tracks[0].items.map((item) => {
    if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
    return item.RemotionGraphic;
  });
  const read = await service.execute("get_graphic_draft", {
    itemId: items[0].id,
  });
  if (!read.ok) throw new Error(read.error.message);
  const draft = read.value as GraphicDraft;
  draft.component.source.files[draft.component.source.entry] +=
    "\n// source change";
  expect(
    await service.execute("save_graphic_draft", {
      itemId: items[0].id,
      sessionId: state.sessionId,
      expectedDraftRevision: 0,
      baseVersion: draft.baseVersion,
      component: draft.component,
    }),
  ).toMatchObject({ ok: true });
  const request = {
    itemId: items[0].id,
    sessionId: state.sessionId,
    expectedRevision: state.revision,
    expectedDraftRevision: 1,
    requestId: randomUUID(),
  };
  return { state, service, items, draft, request };
}
async function finish(service: EditingService, request: unknown) {
  const start = await service.execute("start_graphic_promotion", request);
  expect(start, JSON.stringify(start)).toMatchObject({ ok: true });
  if (!start.ok) throw new Error(start.error.message);
  const job = start.value as JobSnapshot;
  let completed: JobSnapshot | undefined;
  await vi.waitFor(() => {
    const current = service.jobs.read(job.id, job.sessionId);
    if (!current.ok) throw new Error(current.error.message);
    expect(["completed", "failed", "cancelled"]).toContain(
      current.value.status,
    );
    completed = current.value;
  });
  return completed!;
}
it("forks one instance by default, preserves its settings, and promotes in one undoable action", async () => {
  const { state, service, items, request } = await fixture();
  const before = structuredClone(state.project);
  const beforeRevision = state.revision;
  const job = await finish(service, request);
  expect(job.result).toMatchObject({ ok: true });
  const after = state.project.timeline.tracks[0].items.map((item) => {
    if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
    return item.RemotionGraphic;
  });
  expect(after[0].component_id).not.toBe(items[0].component_id);
  expect(after[1]).toEqual(items[1]);
  expect(after[0].props).toEqual(items[0].props);
  expect(state.revision).toBe(beforeRevision + 1);
  expect(
    await service.execute("apply_history", {
      sessionId: state.sessionId,
      expectedRevision: state.revision,
      requestId: randomUUID(),
      direction: "undo",
    }),
  ).toMatchObject({ ok: true });
  expect(state.project).toEqual(before);
  expect(
    await service.execute("apply_history", {
      sessionId: state.sessionId,
      expectedRevision: state.revision,
      requestId: randomUUID(),
      direction: "redo",
    }),
  ).toMatchObject({ ok: true });
  expect(state.project.timeline.tracks[0].items[0]).toEqual({
    RemotionGraphic: after[0],
  });
});
it("preserves values by stable property IDs across a shared schema rename", async () => {
  const { state, service, items, draft, request } = await fixture();
  draft.component.properties.caption = draft.component.properties.title;
  delete draft.component.properties.title;
  const title = draft.component.layers.find((layer) => layer.kind === "text");
  if (!title || title.kind !== "text") throw new Error("Missing title");
  title.bindings.text = "caption";
  expect(
    await service.execute("save_graphic_draft", {
      itemId: items[0].id,
      sessionId: state.sessionId,
      expectedDraftRevision: 1,
      baseVersion: draft.baseVersion,
      component: draft.component,
    }),
  ).toMatchObject({ ok: true });
  expect(
    (
      await finish(service, {
        ...request,
        expectedDraftRevision: 2,
        scope: "shared",
      })
    ).result,
  ).toMatchObject({ ok: true });
  for (const [
    index,
    item,
  ] of state.project.timeline.tracks[0].items.entries()) {
    if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
    expect(item.RemotionGraphic.props.caption).toBe(`Card ${index}`);
    expect(item.RemotionGraphic.props.title_x).toBe(300 + index);
    expect(item.RemotionGraphic.props).not.toHaveProperty("title");
  }
});
it("requires an explicit mapping for replaced property IDs instead of resetting content", async () => {
  const { state, service, items, draft, request } = await fixture();
  const oldId = draft.component.properties.title.id;
  const newId = randomUUID();
  draft.component.properties.title.id = newId;
  await service.execute("save_graphic_draft", {
    itemId: items[0].id,
    sessionId: state.sessionId,
    expectedDraftRevision: 1,
    baseVersion: draft.baseVersion,
    component: draft.component,
  });
  const before = state.snapshot();
  expect(
    (await finish(service, { ...request, expectedDraftRevision: 2 })).result,
  ).toMatchObject({ ok: false, error: { code: "MIGRATION_REQUIRED" } });
  expect(state.snapshot()).toEqual(before);
  expect(
    (
      await finish(service, {
        ...request,
        requestId: randomUUID(),
        expectedDraftRevision: 2,
        mappings: { properties: { [oldId]: newId } },
      })
    ).result,
  ).toMatchObject({ ok: true });
});
it("keeps active source on runtime failure and rejects edits made while validation runs", async () => {
  const { state, service, items, request } = await fixture();
  const before = state.snapshot();
  vi.mocked(GraphicPreviewService.prototype.render).mockResolvedValueOnce({
    ok: false,
    error: { code: "RENDER_FAILED", message: "Draft threw" },
  });
  expect((await finish(service, request)).result).toMatchObject({
    ok: false,
    error: { code: "RENDER_FAILED" },
  });
  expect(state.snapshot()).toEqual(before);
  vi.mocked(GraphicPreviewService.prototype.render).mockImplementationOnce(
    async () => {
      await service.execute("update_item", {
        itemId: items[1].id,
        patch: {
          kind: "RemotionGraphic",
          changes: { props: { title: "Manual edit" } },
        },
      });
      return frame;
    },
  );
  expect(
    (await finish(service, { ...request, requestId: randomUUID() })).result,
  ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  expect(state.project.components).toEqual(before.project.components);
});
