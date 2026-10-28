/** @vitest-environment node */
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import type { Project } from "../../shared/ipc-contract";
import type { RemotionGraphicItem } from "../../shared/graphics";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { GraphicRenderCache } from "../GraphicRenderCache";
import type { GraphicRenderJob } from "../graphic-render-job";

const caches: GraphicRenderCache[] = [];
afterEach(async () => {
  await Promise.all(caches.splice(0).map((cache) => cache.close()));
});

async function projectWithCards(count: number) {
  const state = new AppState();
  const service = new EditingService(state);
  await service.execute("update_project", {
    settings: { width: 64, height: 36, fps: 10 },
  });
  for (let index = 0; index < count; index += 1) {
    const added = await service.execute("add_graphic_item", {
      templateId: "title-card",
      trackId: "graphics",
      timelineStartUs: index * 1000000,
      durationUs: 1000000,
      props: { title: "Same" },
    });
    if (!added.ok) throw new Error(added.error.message);
  }
  return state.project;
}

function cards(project: Project): RemotionGraphicItem[] {
  return project.timeline.tracks
    .flatMap((track) => track.items)
    .flatMap((item) =>
      "RemotionGraphic" in item ? [item.RemotionGraphic] : [],
    );
}

function retitled(project: Project, itemId: string, title: string): Project {
  const next = structuredClone(project);
  const card = cards(next).find((item) => item.id === itemId);
  if (!card) throw new Error("Missing card");
  card.props = { ...card.props, title };
  return next;
}

function fakeRenderer() {
  const jobs: GraphicRenderJob[] = [];
  const gates: (() => void)[] = [];
  let held = false;
  const render = vi.fn(
    async (job: GraphicRenderJob, _directory: string, signal?: AbortSignal) => {
      jobs.push(job);
      if (held) await new Promise<void>((done) => gates.push(done));
      if (signal?.aborted)
        return {
          ok: false as const,
          error: { code: "CANCELLED", message: "Graphics render cancelled." },
        };
      await writeFile(job.output, job.values.title as string);
      return { ok: true as const, value: job.output };
    },
  );
  return {
    render,
    jobs,
    hold: () => {
      held = true;
    },
    release: () => {
      held = false;
      gates.splice(0).forEach((open) => open());
    },
  };
}

function cache(renderer: ReturnType<typeof fakeRenderer>) {
  const value = new GraphicRenderCache(renderer.render);
  caches.push(value);
  return value;
}

it("renders a whole card once as a preview WebM and reuses the file", async () => {
  const project = await projectWithCards(1);
  const [card] = cards(project);
  const renderer = fakeRenderer();
  const renders = cache(renderer);
  const first = await renders.prepare(project, card.id);
  const second = await renders.prepare(project, card.id);
  expect(first).toMatchObject({ ok: true });
  expect(second).toEqual(first);
  expect(renderer.render).toHaveBeenCalledTimes(1);
  expect(renderer.jobs[0]).toMatchObject({
    format: "webm",
    duration: 10,
    renderFrames: 10,
  });
  if (!first.ok) throw new Error(first.error.message);
  expect(first.value.endsWith(".webm")).toBe(true);
  expect(existsSync(first.value)).toBe(true);
  expect(renders.owns(first.value)).toBe(true);
  expect(renders.owns("/etc/passwd")).toBe(false);
});

it("renders again when instance content changes and keeps the earlier render", async () => {
  const project = await projectWithCards(1);
  const [card] = cards(project);
  const renderer = fakeRenderer();
  const renders = cache(renderer);
  const before = await renders.prepare(project, card.id);
  const after = await renders.prepare(
    retitled(project, card.id, "Edited"),
    card.id,
  );
  const undone = await renders.prepare(project, card.id);
  expect(after).toMatchObject({ ok: true });
  expect(after).not.toEqual(before);
  expect(undone).toEqual(before);
  expect(renderer.render).toHaveBeenCalledTimes(2);
});

it("shares one render between cards with identical content", async () => {
  const project = await projectWithCards(2);
  const [first, second] = cards(project);
  const renderer = fakeRenderer();
  const renders = cache(renderer);
  const results = await Promise.all([
    renders.prepare(project, first.id),
    renders.prepare(project, second.id),
  ]);
  expect(results[0]).toMatchObject({ ok: true });
  expect(results[1]).toEqual(results[0]);
  expect(renderer.render).toHaveBeenCalledTimes(1);
});

it("renders one card at a time and skips queued content a newer edit replaced", async () => {
  const project = await projectWithCards(2);
  const [first, second] = cards(project);
  const renderer = fakeRenderer();
  const renders = cache(renderer);
  renderer.hold();
  const running = renders.prepare(project, first.id);
  const stale = renders.prepare(
    retitled(project, second.id, "Draft"),
    second.id,
  );
  const latest = renders.prepare(
    retitled(project, second.id, "Final"),
    second.id,
  );
  await vi.waitFor(() => expect(renderer.render).toHaveBeenCalledTimes(1));
  renderer.release();
  expect(await running).toMatchObject({ ok: true });
  expect(await stale).toMatchObject({
    ok: false,
    error: { code: "CANCELLED" },
  });
  expect(await latest).toMatchObject({ ok: true });
  expect(renderer.jobs.map((job) => job.values.title)).toEqual([
    "Same",
    "Final",
  ]);
});

it("cancels outstanding renders when the project closes and keeps completed ones", async () => {
  const project = await projectWithCards(2);
  const [first, second] = cards(project);
  const renderer = fakeRenderer();
  const renders = cache(renderer);
  const completed = await renders.prepare(project, first.id);
  renderer.hold();
  const running = renders.prepare(
    retitled(project, first.id, "Running"),
    first.id,
  );
  const queued = renders.prepare(
    retitled(project, second.id, "Queued"),
    second.id,
  );
  await vi.waitFor(() => expect(renderer.render).toHaveBeenCalledTimes(2));
  renders.cancelPending();
  renderer.release();
  expect(await running).toMatchObject({
    ok: false,
    error: { code: "CANCELLED" },
  });
  expect(await queued).toMatchObject({
    ok: false,
    error: { code: "CANCELLED" },
  });
  expect(renderer.render).toHaveBeenCalledTimes(2);
  expect(await renders.prepare(project, first.id)).toEqual(completed);
});

it("removes its renders when closed", async () => {
  const project = await projectWithCards(1);
  const [card] = cards(project);
  const renders = new GraphicRenderCache(fakeRenderer().render);
  const result = await renders.prepare(project, card.id);
  if (!result.ok) throw new Error(result.error.message);
  await renders.close();
  expect(existsSync(result.value)).toBe(false);
  expect(renders.owns(result.value)).toBe(false);
  expect(await renders.prepare(project, card.id)).toMatchObject({
    ok: false,
    error: { code: "UNAVAILABLE" },
  });
});

it("reports idle only once queued renders have finished", async () => {
  const project = await projectWithCards(1);
  const [card] = cards(project);
  const renderer = fakeRenderer();
  const renders = cache(renderer);
  renderer.hold();
  void renders.prepare(project, card.id);
  let idle = false;
  void renders.idle().then(() => {
    idle = true;
  });
  await vi.waitFor(() => expect(renderer.render).toHaveBeenCalled());
  expect(idle).toBe(false);
  renderer.release();
  await vi.waitFor(() => expect(idle).toBe(true));
});
