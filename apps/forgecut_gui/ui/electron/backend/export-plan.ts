import type { Project } from "./state.js";
import { assetIdOf, itemData } from "./timeline-ops.js";
import {
  frameAtOrAfter,
  itemFrameRange,
  sequenceDurationUs,
} from "../domain/sequence.js";

import { audioEnvelope } from "../domain/audio.js";

import {
  orderedTimelineItems,
  resolveVisualPlacement,
} from "../domain/visual-placement.js";

export type RenderInput = { path: string; index: number };
export type RenderPlan = {
  inputs: RenderInput[];
  filterGraph: string;
  outputArgs: string[];
  outputPath: string;
  textFiles: { name: string; content: string }[];
};

export function compileExportPlan(project: Project): RenderPlan {
  const { width, height, fps, sample_rate: sampleRate } = project.settings;
  const duration = sequenceDurationUs(project) / 1_000_000;
  const frameCount = frameAtOrAfter(sequenceDurationUs(project), fps);
  if (duration <= 0) throw new Error("The sequence has no duration to export.");
  const inputs: RenderInput[] = [];
  const textFiles: RenderPlan["textFiles"] = [];
  const filters = [
    `color=c=black:s=${width}x${height}:r=${fps}:d=${duration}[basev]`,
    `anullsrc=r=${sampleRate}:cl=stereo,atrim=duration=${duration}[basea]`,
  ];
  const audioLabels = ["[basea]"];
  let videoLabel = "basev";
  let layerIndex = 0;
  for (const { item } of orderedTimelineItems(project)) {
    const range = itemFrameRange(item, fps);
    if (range.end <= range.start || range.start >= frameCount) continue;
    const length = (range.end - range.start) / fps;
    const active = `gte(round(t*${fps}),${range.start})*lt(round(t*${fps}),${range.end})`;
    const data = itemData(item);
    const index = layerIndex;
    layerIndex += 1;
    if ("TextOverlay" in item) {
      const text = item.TextOverlay;
      const name = `text-${index}.txt`;
      textFiles.push({ name, content: text.text });
      filters.push(
        `[${videoLabel}]drawtext=textfile='${name}':expansion=none:fontsize=${text.font_size}:fontcolor=0x${text.color.slice(1)}:x=${text.x}:y=${text.y}:enable='${active}'[video${index}]`,
      );
      videoLabel = `video${index}`;
      continue;
    }
    const asset = project.assets.find(
      (candidate) => candidate.id === assetIdOf(item),
    );
    if (!asset) throw new Error(`Missing source asset for ${data.id}`);
    let input = inputs.find((candidate) => candidate.path === asset.path);
    if (!input) {
      input = { path: asset.path, index: inputs.length };
      inputs.push(input);
    }
    if ("VideoClip" in item || "ImageOverlay" in item) {
      const image = "ImageOverlay" in item;
      const placement = resolveVisualPlacement(project, item);
      if (!placement) throw new Error("Missing visual placement");
      const { x, y, width: targetWidth, height: targetHeight } = placement;
      const fitFilter =
        placement.fit === "cover"
          ? `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight}`
          : `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black@0`;
      const trim =
        "VideoClip" in item
          ? `trim=start=${item.VideoClip.source_in_us / 1_000_000}:end=${item.VideoClip.source_out_us / 1_000_000},`
          : "";
      filters.push(
        `[${input.index}:v]${trim}setpts=PTS-STARTPTS,${image ? "" : `fps=${fps},`}format=rgba,${fitFilter},colorchannelmixer=aa=${placement.opacity},setpts=PTS+${range.start}/${fps}/TB[visual${index}]`,
      );
      filters.push(
        `[${videoLabel}][visual${index}]overlay=x=${x}:y=${y}:format=rgb:eof_action=repeat:repeatlast=1:enable='${active}'[video${index}]`,
      );
      videoLabel = `video${index}`;
    }
    if (
      "AudioClip" in item ||
      ("VideoClip" in item && (asset.probe?.audio_channels ?? 0) > 0)
    ) {
      const clip = "AudioClip" in item ? item.AudioClip : item.VideoClip;
      const envelope = audioEnvelope(item, length * 1_000_000);
      const delay = Math.round((range.start / fps) * sampleRate);
      const fades = [
        envelope.fadeInUs > 0
          ? `,afade=t=in:d=${envelope.fadeInUs / 1_000_000}`
          : "",
        envelope.fadeOutUs > 0
          ? `,afade=t=out:st=${length - envelope.fadeOutUs / 1_000_000}:d=${envelope.fadeOutUs / 1_000_000}`
          : "",
      ].join("");
      filters.push(
        `[${input.index}:a]atrim=start=${clip.source_in_us / 1_000_000}:end=${clip.source_out_us / 1_000_000},asetpts=PTS-STARTPTS,aresample=${sampleRate},aformat=channel_layouts=stereo,volume=${envelope.volume}${fades},atrim=duration=${length},adelay=${delay}S:all=1[audio${index}]`,
      );
      audioLabels.push(`[audio${index}]`);
    }
  }
  filters.push(`[${videoLabel}]format=yuv420p[outv]`);
  filters.push(
    `${audioLabels.join("")}amix=inputs=${audioLabels.length}:normalize=0:duration=first:dropout_transition=0[outa]`,
  );
  return {
    inputs,
    textFiles,
    filterGraph: filters.join(";"),
    outputPath: "output.mp4",
    outputArgs: [
      "-map",
      "[outv]",
      "-map",
      "[outa]",
      "-frames:v",
      String(frameCount),
      "-t",
      String(duration),
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      String(sampleRate),
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(fps),
    ],
  };
}
