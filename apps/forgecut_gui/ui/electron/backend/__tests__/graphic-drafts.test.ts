/** @vitest-environment node */
import { mkdtemp, rm, mkdir, utimes, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import type { GraphicDraft } from "../../shared/graphic-draft";
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "forgecut-drafts-"));
  vi.stubEnv("FORGECUT_DRAFT_DIR", directory);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const state = new AppState();
  const service = new EditingService(state);
  await service.execute("add_graphic_item", {
    templateId: "title-card",
    trackId: "graphics",
    timelineStartUs: 0,
    durationUs: 1000000,
  });
  const item = state.project.timeline.tracks[0].items[0];
  if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
  return { state, service, itemId: item.RemotionGraphic.id };
}
async function read(service: EditingService, itemId: string) {
  const result = await service.execute("get_graphic_draft", { itemId });
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(result.error.message);
  return result.value as GraphicDraft;
}
it("recovers invalid source separately from active project and rejects concurrent stale draft writes", async () => {
  const { state, service, itemId } = await fixture();
  const before = state.snapshot();
  const initial = await read(service, itemId);
  expect(initial.revision).toBe(0);
  const component = structuredClone(initial.component);
  component.source.files[component.source.entry] =
    "export default function Broken( {";
  const args = {
    itemId,
    sessionId: state.sessionId,
    expectedDraftRevision: 0,
    baseVersion: initial.baseVersion,
    component,
  };
  const results = await Promise.all([
    service.execute("save_graphic_draft", args),
    service.execute("save_graphic_draft", args),
  ]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.find((result) => !result.ok)).toMatchObject({
    ok: false,
    error: { code: "CONFLICT" },
  });
  expect(state.snapshot()).toEqual(before);
  const recovered = await read(
    new EditingService(new AppState({ count: 0 }, state.project)),
    itemId,
  );
  expect(recovered.revision).toBe(1);
  expect(recovered.component.source).toEqual(component.source);
  expect(recovered.baseVersion).toBe(initial.baseVersion);
});
it("reverts through a new draft revision without accepting an old writer or changing project history", async () => {
  const { state, service, itemId } = await fixture();
  const before = state.snapshot();
  const initial = await read(service, itemId);
  const component = structuredClone(initial.component);
  component.source.files[component.source.entry] += "\n// draft";
  expect(
    await service.execute("save_graphic_draft", {
      itemId,
      sessionId: state.sessionId,
      expectedDraftRevision: 0,
      baseVersion: initial.baseVersion,
      component,
    }),
  ).toMatchObject({ ok: true });
  expect(
    await service.execute("revert_graphic_draft", {
      itemId,
      sessionId: state.sessionId,
      expectedDraftRevision: 1,
    }),
  ).toMatchObject({
    ok: true,
    value: { revision: 2, component: initial.component },
  });
  expect(
    await service.execute("save_graphic_draft", {
      itemId,
      sessionId: state.sessionId,
      expectedDraftRevision: 0,
      baseVersion: initial.baseVersion,
      component,
    }),
  ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  expect(state.snapshot()).toEqual(before);
  expect(
    await service.execute("save_graphic_draft", {
      itemId,
      sessionId: "stale-session",
      expectedDraftRevision: 2,
      baseVersion: initial.baseVersion,
      component,
    }),
  ).toMatchObject({ ok: false });
});

it("rejects a competing editor instance at the same durable draft revision", async () => {
  const { state, service, itemId } = await fixture();
  const secondState = new AppState({ count: 0 }, state.project);
  const second = new EditingService(secondState);
  const initial = await read(service, itemId);
  const component = structuredClone(initial.component);
  component.source.files[component.source.entry] += "\n// competing writer";
  const args = {
    itemId,
    expectedDraftRevision: 0,
    baseVersion: initial.baseVersion,
    component,
  };
  const results = await Promise.all([
    service.execute("save_graphic_draft", {
      ...args,
      sessionId: state.sessionId,
    }),
    second.execute("save_graphic_draft", {
      ...args,
      sessionId: secondState.sessionId,
    }),
  ]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.find((result) => !result.ok)).toMatchObject({
    ok: false,
    error: { code: "CONFLICT" },
  });
});

it("recovers a stale draft lock left by an interrupted editor", async () => {
  const { state, service, itemId } = await fixture();
  const initial = await read(service, itemId);
  const lockPath = join(directory, `${state.project.id}-${itemId}.json.lock`);
  await mkdir(lockPath);
  const stale = new Date(Date.now() - 20000);
  await utimes(lockPath, stale, stale);
  expect(
    await service.execute("save_graphic_draft", {
      itemId,
      sessionId: state.sessionId,
      expectedDraftRevision: 0,
      baseVersion: initial.baseVersion,
      component: initial.component,
    }),
  ).toMatchObject({ ok: true, value: { revision: 1 } });
  await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
});
