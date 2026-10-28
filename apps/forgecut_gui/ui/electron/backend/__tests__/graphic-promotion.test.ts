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
    await service.closePreviews();
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
it("retains component versions used by other sequences when applying default-instance source", async () => {
  const { state, service, items, request } = await fixture();
  const sequenceId = randomUUID();
  state.executeProjectChange((project) => {
    const other = project.timeline.tracks[0].items.pop();
    if (!other || !("RemotionGraphic" in other))
      throw new Error("Missing second graphic");
    const trackId = randomUUID();
    other.RemotionGraphic.track_id = trackId;
    project.sequences = [
      {
        id: sequenceId,
        name: "Portrait",
        settings: { ...project.settings, width: 1080, height: 1920 },
        timeline: {
          tracks: [{ id: trackId, kind: "Graphics", items: [other] }],
          markers: [],
        },
      },
    ];
  });
  const before = structuredClone(state.project);
  const completed = await finish(service, {
    ...request,
    expectedRevision: state.revision,
  });
  expect(completed.result, JSON.stringify(completed.result)).toMatchObject({
    ok: true,
  });
  expect(state.project.sequences).toEqual(before.sequences);
  expect(state.project.components).toContainEqual(
    before.components?.find(
      (component) =>
        component.id === items[1].component_id &&
        component.version === items[1].component_version,
    ),
  );
  const after = structuredClone(state.project);
  state.undo();
  expect(state.project).toEqual(before);
  state.redo();
  expect(state.project).toEqual(after);
  const path = join(directory, "sequences.forgecut");
  await state.saveProject(path);
  const reopened = new AppState();
  await reopened.loadProject(path);
  expect(reopened.project).toEqual(after);
});
it.each(["instance", "shared"] as const)(
  "applies %s source across sequence ownership without discarding the saved draft",
  async (scope) => {
    const { state, service, items, draft, request } = await fixture();
    const clip = randomUUID();
    state.executeProjectChange((project) => {
      const moved = project.timeline.tracks[0].items.shift();
      if (!moved || !("RemotionGraphic" in moved))
        throw new Error("Missing first graphic");
      const track = randomUUID();
      moved.RemotionGraphic.track_id = track;
      project.sequences = [
        {
          id: clip,
          name: "Portrait",
          settings: { ...project.settings, width: 360, height: 640, fps: 10 },
          timeline: {
            tracks: [{ id: track, kind: "Graphics", items: [moved] }],
            markers: [],
          },
        },
      ];
    });
    const before = structuredClone(state.project);
    const completed = await finish(service, {
      ...request,
      expectedRevision: state.revision,
      scope,
    });
    expect(completed.result).toMatchObject({
      ok: true,
      value: { changedItemIds: expect.arrayContaining([items[0].id]) },
    });
    const changed = state.project.sequences![0].timeline.tracks[0].items[0];
    if (!("RemotionGraphic" in changed)) throw new Error("Missing graphic");
    expect(changed.RemotionGraphic.component_version).not.toBe(
      items[0].component_version,
    );
    const active = state.project.components!.find(
      (component) =>
        component.id === changed.RemotionGraphic.component_id &&
        component.version === changed.RemotionGraphic.component_version,
    );
    expect(active?.source).toEqual(draft.component.source);
    expect(
      await service.execute("get_graphic_draft", { itemId: items[0].id }),
    ).toMatchObject({
      ok: true,
      value: { component: { source: draft.component.source } },
    });
    expect(
      vi
        .mocked(GraphicPreviewService.prototype.render)
        .mock.calls.filter((args) => args[2] === items[0].id)
        .map((args) => args[4]),
    ).toEqual([0, 9]);
    expect(state.snapshot().undoSequenceId).toBe(
      scope === "shared" ? undefined : clip,
    );
    if (scope === "instance")
      expect(state.project.timeline).toEqual(before.timeline);
    else {
      const other = state.project.timeline.tracks[0].items[0];
      expect(other).toMatchObject({
        RemotionGraphic: {
          component_id: changed.RemotionGraphic.component_id,
          component_version: changed.RemotionGraphic.component_version,
          props: items[1].props,
        },
      });
    }
    state.undo(clip);
    expect(state.project).toEqual(before);
  },
);
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

it("rejects missing declared resources before source validation", async () => {
  const { state, service, items, draft, request } = await fixture();
  draft.component.dependencies.assets = [randomUUID()];
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
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringContaining("Missing image resource") },
  });
  expect(state.snapshot()).toEqual(before);
});

it("rejects a newer draft saved during validation without changing active source", async () => {
  const { state, service, items, draft, request } = await fixture();
  const before = state.snapshot();
  vi.mocked(GraphicPreviewService.prototype.render).mockImplementationOnce(
    async () => {
      draft.component.source.files[draft.component.source.entry] +=
        "\n// newer manual draft";
      expect(
        await service.execute("save_graphic_draft", {
          itemId: items[0].id,
          sessionId: state.sessionId,
          expectedDraftRevision: 1,
          baseVersion: draft.baseVersion,
          component: draft.component,
        }),
      ).toMatchObject({ ok: true });
      return frame;
    },
  );
  expect((await finish(service, request)).result).toMatchObject({
    ok: false,
    error: { code: "CONFLICT" },
  });
  expect(state.snapshot()).toEqual(before);
});
it("cancels promotion before the project commit and retains the active version", async () => {
  const { state, service, request } = await fixture();
  const before = state.snapshot();
  let release!: () => void;
  vi.mocked(GraphicPreviewService.prototype.render).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve(frame);
      }),
  );
  const started = await service.execute("start_graphic_promotion", request);
  if (!started.ok) throw new Error(started.error.message);
  const job = started.value as JobSnapshot;
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(service.jobs.cancel(job.id, job.sessionId)).toMatchObject({
    ok: true,
  });
  release();
  expect((await finish(service, request)).status).toBe("cancelled");
  expect(state.snapshot()).toEqual(before);
});

it("advances the recoverable draft to the applied component so editing can continue", async () => {
  const { state, service, items, request } = await fixture();
  expect((await finish(service, request)).result).toMatchObject({ ok: true });
  const active = state.project.timeline.tracks[0].items[0];
  if (!("RemotionGraphic" in active)) throw new Error("Missing graphic");
  expect(
    await service.execute("get_graphic_draft", { itemId: items[0].id }),
  ).toMatchObject({
    ok: true,
    value: {
      revision: 2,
      baseVersion: active.RemotionGraphic.component_version,
      component: {
        id: active.RemotionGraphic.component_id,
        version: active.RemotionGraphic.component_version,
      },
    },
  });
});
