import { createHash } from "node:crypto";
import type { Project } from "../shared/ipc-contract.js";
import type { GraphicValues } from "../shared/graphics.js";
import type {
  GraphicPreviewInput,
  GraphicPreviewFrame,
} from "../shared/graphic-preview.js";
import type { Result } from "../shared/result.js";
import { frameAtOrAfter } from "../domain/sequence.js";
import { validateGraphicProperties } from "../domain/graphic-properties.js";
import { validateGraphicDependencies } from "../domain/graphic-dependencies.js";
import { graphicResourceInputs } from "./graphic-inputs.js";
import { checkGraphicSource } from "./graphic-source-check.js";
import { GraphicPreviewHost } from "./GraphicPreviewHost.js";

type Prepared = Omit<GraphicPreviewInput, "values" | "layerStates" | "frame">;
export class GraphicPreviewService {
  private readonly host = new GraphicPreviewHost();

  private readonly cache = new Map<string, Promise<Result<Prepared>>>();

  private controller = new AbortController();

  private readonly preparing = new Set<Promise<Result<Prepared>>>();

  private epoch = 0;

  private closed = false;
  private resetting: Promise<void> = Promise.resolve();

  async render(
    project: Project,
    sessionId: string,
    itemId: string,
    values: GraphicValues | undefined,
    frame: number,
    signal?: AbortSignal,
  ): Promise<Result<GraphicPreviewFrame>> {
    await this.resetting;
    if (this.closed)
      return {
        ok: false,
        error: { code: "UNAVAILABLE", message: "Graphics preview is closed" },
      };
    const { epoch } = this;
    const cancellation = signal
      ? AbortSignal.any([signal, this.controller.signal])
      : this.controller.signal;
    const found = project.timeline.tracks
      .flatMap((track) => track.items)
      .find(
        (item) =>
          "RemotionGraphic" in item && item.RemotionGraphic.id === itemId,
      );
    if (!found || !("RemotionGraphic" in found))
      return {
        ok: false,
        error: { code: "NOT_FOUND", message: "Graphic instance not found" },
      };
    const item = found.RemotionGraphic;
    const component = project.components?.find(
      (candidate) =>
        candidate.id === item.component_id &&
        candidate.version === item.component_version,
    );
    if (!component)
      return {
        ok: false,
        error: { code: "NOT_FOUND", message: "Graphic component not found" },
      };
    const properties = validateGraphicProperties(
      component,
      values ?? item.props,
    );
    if (!properties.ok) return properties;
    const dependencies = validateGraphicDependencies(component);
    if (!dependencies.ok) return dependencies;
    const duration = Math.max(
      1,
      frameAtOrAfter(
        item.timeline_start_us + item.duration_us,
        project.settings.fps,
      ) - frameAtOrAfter(item.timeline_start_us, project.settings.fps),
    );
    if (!Number.isSafeInteger(frame) || frame < 0 || frame >= duration)
      return {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: "Preview frame is outside the graphic duration",
        },
      };
    const references = Object.entries(component.properties)
      .filter(
        ([, property]) => property.type === "font" || property.type === "image",
      )
      .map(([key]) => properties.value[key]);
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          sessionId,
          itemId,
          component.version,
          project.settings,
          duration,
          references,
          project.resources?.map((resource) => [resource.id, resource.sha256]),
        ]),
      )
      .digest("hex");
    let preparing = this.cache.get(key);
    if (!preparing) {
      if (this.preparing.size >= 2)
        return {
          ok: false,
          error: {
            code: "QUEUE_FULL",
            message:
              "Graphic preview resources are preparing; retry the latest frame",
          },
        };
      preparing = (async (): Promise<Result<Prepared>> => {
        const compiled = await checkGraphicSource(
          component.source,
          cancellation,
        );
        if (!compiled.ok) return compiled;
        if (!compiled.value.ok)
          return {
            ok: false,
            error: {
              code: "INVALID_SOURCE",
              message: compiled.value.error.diagnostics
                .map(
                  (diagnostic) =>
                    `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`,
                )
                .join("\n"),
            },
          };
        const resources = await graphicResourceInputs(
          project,
          component,
          properties.value,
        );
        if (!resources.ok) return resources;
        return {
          ok: true,
          value: {
            key,
            code: compiled.value.value.code,
            resources: resources.value,
            width: project.settings.width,
            height: project.settings.height,
            fps: project.settings.fps,
            duration,
          },
        };
      })();
      const pending = preparing;
      this.preparing.add(pending);
      void pending.finally(() => this.preparing.delete(pending));
      this.cache.set(key, preparing);
      while (this.cache.size > 4)
        this.cache.delete(this.cache.keys().next().value ?? "");
    }
    const prepared = await preparing;
    if (!prepared.ok) {
      this.cache.delete(key);
      return prepared;
    }
    if (epoch !== this.epoch || cancellation.aborted)
      return {
        ok: false,
        error: {
          code: "PROJECT_CHANGED",
          message: "Project changed while preparing the graphic preview",
        },
      };
    return this.host.render(
      {
        ...prepared.value,
        values: properties.value,
        layerStates: item.layer_states,
        frame,
      },
      cancellation,
    );
  }

  async reset(): Promise<void> {
    this.epoch += 1;
    this.controller.abort();
    this.controller = new AbortController();
    const pending = [...this.preparing];
    this.cache.clear();
    this.resetting = Promise.allSettled([this.host.reset(), ...pending]).then(
      () => {},
    );
    await this.resetting;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.epoch += 1;
    this.controller.abort();
    await Promise.allSettled([this.host.close(), ...this.preparing]);
    this.cache.clear();
  }
}
