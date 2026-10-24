import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Project } from "../shared/ipc-contract.js";
import type { Result } from "../shared/result.js";
import {
  frameAtOrAfter,
  frameTimeUs,
  itemFrameRange,
  sequenceDurationUs,
} from "../domain/sequence.js";
import { resolveVisualPlacement } from "../domain/visual-placement.js";
import { graphicResourceInputs } from "./graphic-inputs.js";
import { graphicTemplates } from "./graphic-catalog.js";
import { componentVersion } from "./graphic-component.js";
import { renderGraphic } from "./graphic-render.js";

export async function prepareGraphicInputs(
  project: Project,
  directory: string,
  signal?: AbortSignal,
): Promise<Result<Project>> {
  if (
    !project.timeline.tracks.some((track) =>
      track.items.some((item) => "RemotionGraphic" in item),
    )
  )
    return { ok: true, value: project };
  const prepared = structuredClone(project);
  const end = frameAtOrAfter(sequenceDurationUs(project), project.settings.fps);
  const templates = graphicTemplates();
  for (const track of prepared.timeline.tracks) {
    for (let index = 0; index < track.items.length; index += 1) {
      const item = track.items[index];
      if (!("RemotionGraphic" in item)) continue;
      const range = itemFrameRange(item, project.settings.fps);
      if (range.start >= end || range.end <= range.start) continue;
      const graphic = item.RemotionGraphic;
      const component = project.components?.find(
        (candidate) =>
          candidate.id === graphic.component_id &&
          candidate.version === graphic.component_version,
      );
      if (
        !component ||
        !templates.some((template) => template.version === component.version) ||
        componentVersion(component) !== component.version
      )
        return {
          ok: false,
          error: {
            code: "UNSUPPORTED_COMPONENT",
            message:
              "This component version is unavailable in the graphics runtime.",
          },
        };
      const resources = await graphicResourceInputs(
        project,
        component,
        graphic.props,
      );
      if (!resources.ok) return resources;
      const id = randomUUID();
      const duration = range.end - range.start;
      const rendered = await renderGraphic(
        {
          sourceHash: createHash("sha256")
            .update(component.source.files[component.source.entry])
            .digest("hex"),
          output: join(directory, `${id}.mov`),
          width: project.settings.width,
          height: project.settings.height,
          fps: project.settings.fps,
          duration,
          renderFrames: Math.min(duration, end - range.start),
          values: graphic.props,
          layerStates: graphic.layer_states,
          resources: resources.value,
        },
        directory,
        signal,
      );
      if (!rendered.ok) return rendered;
      prepared.assets.push({
        id,
        name: component.name,
        path: rendered.value,
        kind: "Video",
        probe: null,
      });
      track.items[index] = {
        VideoClip: {
          id: graphic.id,
          track_id: graphic.track_id,
          asset_id: id,
          timeline_start_us: graphic.timeline_start_us,
          source_in_us: 0,
          source_out_us: frameTimeUs(duration, project.settings.fps),
          transform: resolveVisualPlacement(project, item),
          layer_order: graphic.layer_order,
          muted: true,
        },
      };
    }
  }
  return { ok: true, value: prepared };
}
