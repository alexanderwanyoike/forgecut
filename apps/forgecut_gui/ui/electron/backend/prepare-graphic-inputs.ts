import { randomUUID } from "node:crypto";
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
import { graphicRenderInputs } from "./graphic-render-inputs.js";
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
  for (const track of prepared.timeline.tracks) {
    for (let index = 0; index < track.items.length; index += 1) {
      const item = track.items[index];
      if (!("RemotionGraphic" in item)) continue;
      const range = itemFrameRange(item, project.settings.fps);
      if (range.start >= end || range.end <= range.start) continue;
      const graphic = item.RemotionGraphic;
      const inputs = await graphicRenderInputs(
        project,
        graphic,
        project.settings,
        signal,
      );
      if (!inputs.ok) return inputs;
      const { name, job } = inputs.value;
      const id = randomUUID();
      const rendered = await renderGraphic(
        {
          ...job,
          output: join(directory, `${id}.mov`),
          renderFrames: Math.min(job.duration, end - range.start),
        },
        directory,
        signal,
      );
      if (!rendered.ok) return rendered;
      prepared.assets.push({
        id,
        name,
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
          source_out_us: frameTimeUs(job.duration, project.settings.fps),
          transform: resolveVisualPlacement(project, item),
          layer_order: graphic.layer_order,
          muted: true,
        },
      };
    }
  }
  return { ok: true, value: prepared };
}
