import { createHash } from "node:crypto";
import { validateGraphicDependencies } from "../domain/graphic-dependencies.js";
import { itemFrameRange } from "../domain/sequence.js";
import type { Project, ProjectSettings } from "../shared/ipc-contract.js";
import type {
  GraphicComponent,
  RemotionGraphicItem,
} from "../shared/graphics.js";
import type { Result } from "../shared/result.js";
import { graphicTemplates } from "./graphic-catalog.js";
import { componentVersion } from "./graphic-component.js";
import { graphicResourceInputs } from "./graphic-inputs.js";
import type { GraphicRenderJob } from "./graphic-render-job.js";
import { checkGraphicSource } from "./graphic-source-check.js";

export type GraphicRenderInputs = Omit<
  GraphicRenderJob,
  "output" | "renderFrames" | "format"
>;

export async function graphicRenderInputs(
  project: Project,
  graphic: RemotionGraphicItem,
  settings: Pick<ProjectSettings, "width" | "height" | "fps">,
  signal?: AbortSignal,
  compile: CompileComponent = projectCode,
): Promise<Result<{ name: string; job: GraphicRenderInputs }>> {
  const component = project.components?.find(
    (candidate) =>
      candidate.id === graphic.component_id &&
      candidate.version === graphic.component_version,
  );
  if (!component || componentVersion(component) !== component.version)
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED_COMPONENT",
        message:
          "This component version is unavailable in the graphics runtime.",
      },
    };
  const dependencies = validateGraphicDependencies(component);
  if (!dependencies.ok) return dependencies;
  const code = await compile(component, signal);
  if (!code.ok) return code;
  const resources = await graphicResourceInputs(
    project,
    component,
    graphic.props,
  );
  if (!resources.ok) return resources;
  const range = itemFrameRange({ RemotionGraphic: graphic }, settings.fps);
  return {
    ok: true,
    value: {
      name: component.name,
      job: {
        sourceHash: createHash("sha256")
          .update(component.source.files[component.source.entry])
          .digest("hex"),
        code: code.value,
        width: settings.width,
        height: settings.height,
        fps: settings.fps,
        duration: range.end - range.start,
        values: graphic.props,
        layerStates: graphic.layer_states,
        resources: resources.value,
      },
    },
  };
}

export type CompileComponent = typeof projectCode;

/** Packaged templates run prepared runtime code; project source is compiled. */
export async function projectCode(
  component: GraphicComponent,
  signal?: AbortSignal,
): Promise<Result<string | undefined>> {
  if (
    graphicTemplates().some(
      (template) => template.version === component.version,
    )
  )
    return { ok: true, value: undefined };
  const checked = await checkGraphicSource(
    component.source,
    signal,
    component.properties,
  );
  if (!checked.ok) return checked;
  if (!checked.value.ok)
    return {
      ok: false,
      error: {
        code: "INVALID_SOURCE",
        message: checked.value.error.diagnostics
          .map(
            (diagnostic) =>
              `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`,
          )
          .join("\n"),
      },
    };
  return { ok: true, value: checked.value.value.code };
}
