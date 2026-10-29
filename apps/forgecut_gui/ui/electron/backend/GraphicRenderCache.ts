import { createHash } from "node:crypto";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveGraphicInstance } from "../domain/graphic-instance.js";
import { itemFrameRange } from "../domain/sequence.js";
import type { Project, ProjectSettings } from "../shared/ipc-contract.js";
import type {
  GraphicComponent,
  RemotionGraphicItem,
} from "../shared/graphics.js";
import type { Result } from "../shared/result.js";
import {
  graphicRenderInputs,
  projectCode,
  type CompileComponent,
} from "./graphic-render-inputs.js";
import type { GraphicRenderJob } from "./graphic-render-job.js";
import { renderGraphic } from "./graphic-render.js";

type Render = (
  job: GraphicRenderJob,
  directory: string,
  signal?: AbortSignal,
) => Promise<Result<string>>;

type Settings = Pick<ProjectSettings, "width" | "height" | "fps">;

const RETAINED_RENDERS = 64;

const RETAINED_COMPILATIONS = 8;

function cancelled(message: string): Result<string> {
  return { ok: false, error: { code: "CANCELLED", message } };
}

/** Whole-card playback renders; see ADR 0006, Playback renders. */
export class GraphicRenderCache {
  private readonly renders = new Map<string, Promise<Result<string>>>();

  private readonly files = new Map<string, string>();

  private readonly wanted = new Map<string, string>();

  private readonly compiled = new Map<string, ReturnType<CompileComponent>>();

  private queue: Promise<unknown> = Promise.resolve();

  private controller = new AbortController();

  private directory?: Promise<string>;

  private closed = false;

  constructor(private readonly render: Render = renderGraphic) {}

  prepare(project: Project, itemId: string): Promise<Result<string>> {
    if (this.closed)
      return Promise.resolve({
        ok: false,
        error: { code: "UNAVAILABLE", message: "Graphics preview is closed" },
      });
    const resolved = resolveGraphicInstance(project, itemId);
    if (!resolved.ok) return Promise.resolve(resolved);
    const { item, component, sequence } = resolved.value;
    const key = renderKey(project, item, component, sequence.settings);
    this.wanted.set(itemId, key);
    const existing = this.renders.get(key);
    if (existing) {
      this.renders.delete(key);
      this.renders.set(key, existing);
      return existing;
    }
    const { signal } = this.controller;
    const run = () =>
      this.produce(project, item, sequence.settings, key, signal);
    const task = this.queue.then(run, run);
    this.queue = task;
    this.renders.set(key, task);
    void task.then(async (result) => {
      if (!result.ok && this.renders.get(key) === task)
        this.renders.delete(key);
      else await this.evict();
    });
    return task;
  }

  /** Settles once every render queued so far has finished. */
  async idle(): Promise<void> {
    await this.queue;
  }

  owns(path: string): boolean {
    return [...this.files.values()].includes(path);
  }

  /** Abandons queued and running renders, for example when the project closes. */
  cancelPending(): void {
    this.controller.abort();
    this.controller = new AbortController();
    this.wanted.clear();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.cancelPending();
    await this.queue;
    this.renders.clear();
    this.files.clear();
    if (this.directory)
      await rm(await this.directory, { recursive: true, force: true });
  }

  private async produce(
    project: Project,
    item: RemotionGraphicItem,
    settings: Settings,
    key: string,
    signal: AbortSignal,
  ): Promise<Result<string>> {
    if (signal.aborted)
      return cancelled("The project closed before this graphic rendered");
    if (![...this.wanted.values()].includes(key))
      return cancelled("A newer edit replaced this graphic render");
    try {
      const inputs = await graphicRenderInputs(
        project,
        item,
        settings,
        signal,
        this.compile,
      );
      if (!inputs.ok) return inputs;
      this.directory ??= mkdtemp(join(tmpdir(), "forgecut-graphic-renders-"));
      const root = await this.directory;
      const job = await mkdtemp(join(root, "job-"));
      try {
        const output = join(job, "render.webm");
        const rendered = await this.render(
          {
            ...inputs.value.job,
            format: "webm",
            output,
            renderFrames: inputs.value.job.duration,
          },
          job,
          signal,
        );
        if (!rendered.ok) return rendered;
        if (signal.aborted)
          return cancelled("The project closed while this graphic rendered");
        const path = join(root, `${key}.webm`);
        await rename(output, path);
        this.files.set(key, path);
        return { ok: true, value: path };
      } finally {
        await rm(job, { recursive: true, force: true });
      }
    } catch (failure) {
      return {
        ok: false,
        error: {
          code: "IO_ERROR",
          message: failure instanceof Error ? failure.message : String(failure),
        },
      };
    }
  }

  private readonly compile: CompileComponent = (component, signal) => {
    const existing = this.compiled.get(component.version);
    if (existing) return existing;
    const code = projectCode(component, signal);
    this.compiled.set(component.version, code);
    void code.then((result) => {
      if (!result.ok) this.compiled.delete(component.version);
    });
    for (const version of this.compiled.keys())
      if (this.compiled.size > RETAINED_COMPILATIONS)
        this.compiled.delete(version);
    return code;
  };

  private async evict(): Promise<void> {
    for (const key of this.renders.keys()) {
      if (this.files.size <= RETAINED_RENDERS) return;
      const path = this.files.get(key);
      if (!path) continue;
      this.renders.delete(key);
      this.files.delete(key);
      await rm(path, { force: true });
    }
  }
}

function renderKey(
  project: Project,
  item: RemotionGraphicItem,
  component: GraphicComponent,
  settings: Settings,
): string {
  const referenced = new Set<unknown>([
    ...Object.values(item.props),
    ...component.dependencies.assets,
    ...component.dependencies.fonts,
  ]);
  const range = itemFrameRange({ RemotionGraphic: item }, settings.fps);
  return createHash("sha256")
    .update(
      JSON.stringify([
        component.version,
        item.props,
        item.layer_states ?? null,
        settings.width,
        settings.height,
        settings.fps,
        range.end - range.start,
        project.resources
          ?.filter((resource) => referenced.has(resource.id))
          .map((resource) => [resource.id, resource.sha256]),
      ]),
    )
    .digest("hex");
}
