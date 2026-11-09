import { join } from "node:path";
import {
  EXPORT_PRESETS,
  type ExportPresetId,
} from "../shared/export-presets.js";
import type { ReviewWindow } from "../domain/review-range.js";
import type { Asset, Project, TimelineItem } from "./state.js";
import type { VisualPlacement } from "../shared/ipc-contract.js";
import { assetIdOf, itemData } from "./timeline-ops.js";
import { itemFrameRange } from "../domain/sequence.js";
import { audioEnvelope } from "../domain/audio.js";
import {
  orderedTimelineItems,
  resolveVisualPlacement,
} from "../domain/visual-placement.js";
import {
  exportFrameRange,
  overlaps,
  planExportSpans,
  type ExportSpan,
  type FrameRange,
  type SpanLayer,
} from "./export-spans.js";
import { MEDIA_SLICE_THREADS } from "./process-budget.js";

export type RenderInput = {
  path: string;
  index: number;
  format?: "concat";
  range?: { startUs: number; durationUs: number };
};
export type RenderPlan = {
  inputs: RenderInput[];
  filterGraph: string;
  outputArgs: string[];
  outputPath: string;
  textFiles: { name: string; content: string }[];
};
export type SpanRender = RenderPlan & { offsetSeconds: number };
export type ExportPlan = { spans: SpanRender[]; mux: RenderPlan };
type VideoGraph = Pick<RenderPlan, "inputs" | "filterGraph" | "textFiles">;

const CONCAT_LIST = "spans.txt";

export function compileExportPlan(
  project: Project,
  window?: ReviewWindow,
  preset: ExportPresetId = "mp4",
  directory = ".",
): ExportPlan {
  const frames = exportFrameRange(project, window);
  if (frames.end <= frames.start)
    throw new Error("The sequence has no duration to export.");
  const { fps } = project.settings;
  const { extension } = EXPORT_PRESETS[preset];
  const planned = planExportSpans(project, frames);
  const files = planned.map((_, index) => `span-${index}.${extension}`);
  const spans = planned.map((span, index) => ({
    ...(span.plain
      ? plainSpan(project, span)
      : compositeSpan(project, span, index)),
    outputPath: join(directory, files[index]),
    offsetSeconds: (span.start - frames.start) / fps,
    outputArgs: [
      "-map",
      "[outv]",
      "-frames:v",
      String(span.end - span.start),
      ...videoEncodingArgs(preset),
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(fps),
    ],
  }));
  return {
    spans,
    mux: muxPlan(project, frames, preset, directory, files),
  };
}

function plainSpan(project: Project, span: ExportSpan): VideoGraph {
  const { width, height } = project.settings;
  const [layer] = span.layers;
  const { input, timing } = videoSource(project, layer, span.start, 0);
  // Colour and 4:4:4 padding match the overlay path's output (ADR 0018).
  const fit = fitFilter(
    width,
    height,
    resolveVisualPlacement(project, layer.item)?.fit,
    {
      scaleOptions: ":out_color_matrix=bt601:out_range=tv",
      workingFormat: "yuv444p",
      padColor: "black",
    },
  );
  return {
    inputs: [input],
    textFiles: [],
    // Cloning the last frame matches the overlay graph's eof_action=repeat when a source ends early.
    filterGraph: `[0:v]${timing},${fit},setsar=1,format=yuv420p,setparams=range=unknown:color_primaries=unknown:color_trc=unknown:colorspace=unknown,tpad=stop_mode=clone:stop=-1[outv]`,
  };
}

function fitFilter(
  width: number,
  height: number,
  fit: VisualPlacement["fit"] | undefined,
  options: { padColor: string; scaleOptions?: string; workingFormat?: string },
): string {
  const cover = fit === "cover";
  const format = options.workingFormat
    ? `,format=${options.workingFormat}`
    : "";
  return `scale=${width}:${height}:force_original_aspect_ratio=${cover ? "increase" : "decrease"}${options.scaleOptions ?? ""}${format},${cover ? `crop=${width}:${height}` : `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${options.padColor}`}`;
}

function compositeSpan(
  project: Project,
  span: ExportSpan,
  spanIndex: number,
): VideoGraph {
  const { width, height, fps } = project.settings;
  const inputs: RenderInput[] = [];
  const textFiles: RenderPlan["textFiles"] = [];
  const filters = [
    `color=c=black:s=${width}x${height}:r=${fps}:d=${(span.end - span.start) / fps}[basev]`,
  ];
  let videoLabel = "basev";
  span.layers.forEach((layer, index) => {
    const { item } = layer;
    const from = Math.max(layer.start, span.start) - span.start;
    const active = `gte(round(t*${fps}),${from})*lt(round(t*${fps}),${layer.end - span.start})`;
    if ("TextOverlay" in item) {
      const text = item.TextOverlay;
      const name = `text-${spanIndex}-${index}.txt`;
      textFiles.push({ name, content: text.text });
      filters.push(
        `[${videoLabel}]drawtext=textfile='${name}':expansion=none:fontsize=${text.font_size}:fontcolor=0x${text.color.slice(1)}:x=${text.x}:y=${text.y}:enable='${active}'[video${index}]`,
      );
      videoLabel = `video${index}`;
      return;
    }
    if (!("VideoClip" in item || "ImageOverlay" in item)) return;
    const { input, timing } = videoSource(
      project,
      layer,
      span.start,
      inputs.length,
    );
    inputs.push(input);
    const placement = resolveVisualPlacement(project, item);
    if (!placement) throw new Error("Missing visual placement");
    const { x, y, width: targetWidth, height: targetHeight } = placement;
    const fit = fitFilter(targetWidth, targetHeight, placement.fit, {
      padColor: "black@0",
    });
    filters.push(
      `[${input.index}:v]${timing},format=rgba,${fit},colorchannelmixer=aa=${placement.opacity},setpts=PTS+${from}/${fps}/TB[visual${index}]`,
    );
    filters.push(
      `[${videoLabel}][visual${index}]overlay=x=${x}:y=${y}:format=rgb:eof_action=repeat:repeatlast=1:enable='${active}'[video${index}]`,
    );
    videoLabel = `video${index}`;
  });
  filters.push(`[${videoLabel}]format=yuv420p[outv]`);
  return { inputs, textFiles, filterGraph: filters.join(";") };
}

function muxPlan(
  project: Project,
  frames: FrameRange,
  preset: ExportPresetId,
  directory: string,
  spanFiles: string[],
): RenderPlan {
  const { fps, sample_rate: sampleRate } = project.settings;
  const duration = (frames.end - frames.start) / fps;
  const { extension } = EXPORT_PRESETS[preset];
  const inputs: RenderInput[] = [
    { path: join(directory, CONCAT_LIST), index: 0, format: "concat" },
  ];
  const filters = [
    `anullsrc=r=${sampleRate}:cl=stereo,atrim=duration=${duration}[basea]`,
  ];
  const audioLabels = ["[basea]"];
  orderedTimelineItems(project).forEach(({ item }, index) => {
    const range = itemFrameRange(item, fps);
    if (
      !("AudioClip" in item || "VideoClip" in item) ||
      !overlaps(range, frames)
    )
      return;
    if (
      "VideoClip" in item &&
      (assetOf(project, item)?.probe?.audio_channels ?? 0) === 0
    )
      return;
    // Item-local timestamps keep the fade clock running from the clip's own start.
    const offset = Math.max(0, frames.start - range.start) / fps;
    const input = sourceInput(
      project,
      item,
      // Flooring keeps the seek at or before the wanted sample.
      Math.floor(offset * 1_000_000),
      inputs.length,
    );
    inputs.push(input);
    const length = (range.end - range.start) / fps;
    const shifted = offset > 0;
    const envelope = audioEnvelope(item, length * 1_000_000);
    const delay = Math.round(
      ((Math.max(range.start, frames.start) - frames.start) / fps) * sampleRate,
    );
    const fades = [
      envelope.fadeInUs > 0
        ? `,afade=t=in:d=${envelope.fadeInUs / 1_000_000}`
        : "",
      envelope.fadeOutUs > 0
        ? `,afade=t=out:st=${length - envelope.fadeOutUs / 1_000_000}:d=${envelope.fadeOutUs / 1_000_000}`
        : "",
    ].join("");
    filters.push(
      `[${input.index}:a]atrim=duration=${input.range!.durationUs / 1_000_000},asetpts=PTS-STARTPTS${shifted ? `+${offset}/TB` : ""},aresample=${sampleRate},aformat=channel_layouts=stereo,volume=${envelope.volume}${fades},atrim=duration=${length - offset}${shifted ? ",asetpts=PTS-STARTPTS" : ""},adelay=${delay}S:all=1[audio${index}]`,
    );
    audioLabels.push(`[audio${index}]`);
  });
  filters.push(
    `${audioLabels.join("")}amix=inputs=${audioLabels.length}:normalize=0:duration=first:dropout_transition=0[outa]`,
  );
  return {
    inputs,
    textFiles: [
      {
        name: CONCAT_LIST,
        content: spanFiles.map((file) => `file '${file}'\n`).join(""),
      },
    ],
    filterGraph: filters.join(";"),
    outputPath: join(directory, `render.${extension}`),
    outputArgs: [
      "-map",
      "0:v",
      "-map",
      "[outa]",
      "-c:v",
      "copy",
      "-t",
      String(duration),
      ...audioEncodingArgs(preset, sampleRate),
    ],
  };
}

function assetOf(project: Project, item: TimelineItem): Asset | undefined {
  const id = assetIdOf(item);
  return project.assets.find((candidate) => candidate.id === id);
}

/** Seeking on the input side means late spans and ranges never decode earlier footage. */
function sourceInput(
  project: Project,
  item: TimelineItem,
  offsetUs: number,
  index: number,
): RenderInput {
  const asset = assetOf(project, item);
  const data = itemData(item);
  if (!asset) throw new Error(`Missing source asset for ${data.id}`);
  if (!("source_in_us" in data)) return { path: asset.path, index };
  return {
    path: asset.path,
    index,
    range: {
      startUs: data.source_in_us + offsetUs,
      durationUs: data.source_out_us - data.source_in_us - offsetUs,
    },
  };
}

/** Mid-clip entry seeks whole source frames and adds them back, keeping the clip-start anchor (ADR 0018). */
function videoSource(
  project: Project,
  layer: SpanLayer,
  fromFrame: number,
  index: number,
): { input: RenderInput; timing: string } {
  const { fps } = project.settings;
  const sourceFps = assetOf(project, layer.item)?.probe?.fps || fps;
  const offsetFrames = Math.max(0, fromFrame - layer.start);
  const skippedFrames = Math.max(
    0,
    Math.floor((offsetFrames / fps - 1) * sourceFps),
  );
  const skippedSeconds = skippedFrames / sourceFps;
  const input = sourceInput(
    project,
    layer.item,
    Math.floor(skippedSeconds * 1_000_000),
    index,
  );
  if (!input.range) return { input, timing: "setpts=PTS-STARTPTS" };
  const anchor =
    skippedFrames > 0
      ? `setpts=PTS-STARTPTS+round(${skippedSeconds}/TB)`
      : "setpts=PTS-STARTPTS";
  const continuous = `trim=duration=${input.range.durationUs / 1_000_000},${anchor},fps=${fps}`;
  return {
    input,
    timing:
      offsetFrames > 0
        ? `${continuous}:start_time=0,trim=start_frame=${offsetFrames},setpts=PTS-STARTPTS`
        : continuous,
  };
}

function videoEncodingArgs(preset: ExportPresetId): string[] {
  if (preset === "webm")
    return [
      "-c:v",
      "libvpx-vp9",
      "-threads",
      MEDIA_SLICE_THREADS,
      "-crf",
      "32",
      "-b:v",
      "0",
      "-deadline",
      "good",
      "-cpu-used",
      "4",
    ];
  return ["-c:v", "libx264", "-threads", MEDIA_SLICE_THREADS, "-crf", "23"];
}

function audioEncodingArgs(
  preset: ExportPresetId,
  sampleRate: number,
): string[] {
  if (preset === "webm")
    return ["-c:a", "libopus", "-b:a", "128k", "-ar", "48000"];
  return ["-c:a", "aac", "-b:a", "192k", "-ar", String(sampleRate)];
}
