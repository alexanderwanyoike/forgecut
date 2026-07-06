import { spawn } from "node:child_process";
import type {
  Asset,
  Project,
  TimelineItem,
} from "./state.js";
import {
  assetIdOf,
  itemVariant,
  timelineEndUs,
  timelineStartUs,
} from "./timeline-ops.js";

export type RenderPlan = {
  inputs: RenderInput[];
  filterGraph: string;
  outputArgs: string[];
  outputPath: string;
};

export type RenderInput = {
  path: string;
  index: number;
};

export type RenderProgress = {
  percent: number;
  frame: number;
  fps: number;
  speed: string;
  eta_seconds: number | null;
};

type ExportOptions = {
  onProgress?: (progress: RenderProgress) => void;
};

type VideoClipItem = Extract<TimelineItem, { VideoClip: unknown }>;
type AudioClipItem = Extract<TimelineItem, { AudioClip: unknown }>;
type ImageOverlayItem = Extract<TimelineItem, { ImageOverlay: unknown }>;
type TextOverlayItem = Extract<TimelineItem, { TextOverlay: unknown }>;

export async function exportProject(
  project: Project,
  outputPath: string,
  options: ExportOptions = {},
): Promise<void> {
  const plan = compileExportPlan(project);
  plan.outputPath = outputPath;

  await executeRenderPlan(
    plan,
    totalTimelineDurationUs(project) / 1_000_000,
    options.onProgress,
  );
}

export function compileExportPlan(project: Project): RenderPlan {
  const videoTracks = project.timeline.tracks.filter((track) => track.kind === "Video");
  const primaryTrack = videoTracks[0];
  if (!primaryTrack) throw new Error("No clips to export");

  const videoClips = primaryTrack.items
    .filter(isVideoClip)
    .sort((a, b) => timelineStartUs(a) - timelineStartUs(b));
  if (videoClips.length === 0) throw new Error("No clips to export");

  const pipClips = videoTracks
    .slice(1)
    .flatMap((track) => track.items)
    .filter(isVideoClip);

  const imageOverlays = project.timeline.tracks
    .filter((track) => track.kind === "OverlayImage")
    .flatMap((track) => track.items)
    .filter(isImageOverlay)
    .sort((a, b) => timelineStartUs(a) - timelineStartUs(b));

  const audioClips = project.timeline.tracks
    .filter((track) => track.kind === "Audio")
    .flatMap((track) => track.items)
    .filter(isAudioClip)
    .sort((a, b) => timelineStartUs(a) - timelineStartUs(b));

  const textOverlays = project.timeline.tracks
    .filter((track) => track.kind === "OverlayText")
    .flatMap((track) => track.items)
    .filter(isTextOverlay);

  const inputs: RenderInput[] = [];
  const pathToIndex = new Map<string, number>();
  for (const item of [...videoClips, ...imageOverlays, ...pipClips, ...audioClips]) {
    registerInput(project, item, pathToIndex, inputs);
  }

  const filters: string[] = [];
  const projectWidth = project.settings.width;
  const projectHeight = project.settings.height;

  videoClips.forEach((clip, index) => {
    const data = clip.VideoClip;
    const asset = requireAsset(project.assets, data.asset_id);
    const inputIndex = requireInputIndex(pathToIndex, asset.path);
    const startSeconds = usToSeconds(data.source_in_us);
    const endSeconds = usToSeconds(data.source_out_us);
    const needsScale =
      asset.probe !== null &&
      (asset.probe.width !== projectWidth || asset.probe.height !== projectHeight);
    const scaleFilter = needsScale
      ? `,scale=${projectWidth}:${projectHeight}:force_original_aspect_ratio=decrease,pad=${projectWidth}:${projectHeight}:(ow-iw)/2:(oh-ih)/2`
      : "";

    filters.push(
      `[${inputIndex}:v]trim=start=${startSeconds}:end=${endSeconds},setpts=PTS-STARTPTS${scaleFilter}[v${index}]`,
    );
    filters.push(
      `[${inputIndex}:a]atrim=start=${startSeconds}:end=${endSeconds},asetpts=PTS-STARTPTS[a${index}]`,
    );
  });

  const hasAudioOverlay = audioClips.length > 0;
  const hasImageOverlay = imageOverlays.length > 0;
  const hasPip = pipClips.length > 0;
  const videoAudioOut = hasAudioOverlay ? "concat_a" : "outa";
  const concatVideoLabel = hasPip ? "concatv" : hasImageOverlay ? "basev" : "outv";
  const concatInputs = videoClips.map((_, index) => `[v${index}][a${index}]`).join("");

  filters.push(
    `${concatInputs}concat=n=${videoClips.length}:v=1:a=1[${concatVideoLabel}][${videoAudioOut}]`,
  );

  if (hasPip) {
    filters.push(
      compilePipOverlays(
        project,
        pathToIndex,
        concatVideoLabel,
        hasImageOverlay ? "basev" : "outv",
        pipClips,
      ),
    );
  }

  if (hasAudioOverlay) {
    audioClips.forEach((clip, index) => {
      const data = clip.AudioClip;
      const asset = requireAsset(project.assets, data.asset_id);
      const inputIndex = requireInputIndex(pathToIndex, asset.path);
      const startSeconds = usToSeconds(data.source_in_us);
      const endSeconds = usToSeconds(data.source_out_us);
      const durationSeconds = endSeconds - startSeconds;
      const delayMs = Math.trunc(data.timeline_start_us / 1000);
      const fadeOutStart = Math.max(durationSeconds - 0.1, 0);

      filters.push(
        `[${inputIndex}:a]atrim=start=${startSeconds}:end=${endSeconds},asetpts=PTS-STARTPTS,volume=${data.volume},afade=t=in:d=0.1,afade=t=out:st=${fadeOutStart}:d=0.1,adelay=${delayMs}|${delayMs}[ovla${index}]`,
      );
    });

    const amixInputs = [
      `[${videoAudioOut}]`,
      ...audioClips.map((_, index) => `[ovla${index}]`),
    ].join("");
    filters.push(
      `${amixInputs}amix=inputs=${audioClips.length + 1}:duration=longest:dropout_transition=0[outa]`,
    );
  }

  if (hasImageOverlay) {
    let currentVideoLabel = "basev";
    imageOverlays.forEach((overlay, index) => {
      const data = overlay.ImageOverlay;
      const asset = requireAsset(project.assets, data.asset_id);
      const inputIndex = requireInputIndex(pathToIndex, asset.path);
      const startSeconds = usToSeconds(data.timeline_start_us);
      const endSeconds = usToSeconds(data.timeline_start_us + data.duration_us);
      const scaledLabel = `img_scaled_${index}`;
      const alphaLabel = `img_alpha_${index}`;
      const nextLabel = index === imageOverlays.length - 1 ? "outv" : `ov_${index}`;

      filters.push(`[${inputIndex}:v]scale=${data.width}:${data.height}[${scaledLabel}]`);
      filters.push(
        `[${scaledLabel}]format=rgba,colorchannelmixer=aa=${data.opacity}[${alphaLabel}]`,
      );
      filters.push(
        `[${currentVideoLabel}][${alphaLabel}]overlay=x=${data.x}:y=${data.y}:enable='between(t,${startSeconds},${endSeconds})'[${nextLabel}]`,
      );

      currentVideoLabel = nextLabel;
    });
  }

  if (textOverlays.length > 0) {
    const drawTextChain = textOverlays
      .map((overlay) => {
        const data = overlay.TextOverlay;
        const startSeconds = usToSeconds(data.timeline_start_us);
        const endSeconds = usToSeconds(data.timeline_start_us + data.duration_us);
        const text = escapeDrawtext(data.text);
        const color = data.color.startsWith("#") ? data.color.slice(1) : data.color;
        return `drawtext=text='${text}':fontsize=${data.font_size}:fontcolor=0x${color}:x=${data.x}:y=${data.y}:enable='between(t,${startSeconds},${endSeconds})'`;
      })
      .join(",");
    filters.push(`[outv]${drawTextChain}[outv_txt]`);
  }

  const finalVideoLabel = textOverlays.length > 0 ? "outv_txt" : "outv";

  return {
    inputs,
    filterGraph: filters.join(";"),
    outputArgs: [
      "-map",
      `[${finalVideoLabel}]`,
      "-map",
      "[outa]",
      "-c:v",
      "libx264",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-pix_fmt",
      "yuv420p",
      "-vsync",
      "cfr",
      "-r",
      `${project.settings.fps}`,
    ],
    outputPath: "output.mp4",
  };
}

export function buildFfmpegArgs(plan: RenderPlan): string[] {
  return [
    "-y",
    ...plan.inputs.flatMap((input) => ["-i", input.path]),
    "-filter_complex",
    plan.filterGraph,
    ...plan.outputArgs,
    plan.outputPath,
  ];
}

export function parseProgress(line: string, totalSeconds: number): RenderProgress | null {
  if (!line.includes("time=")) return null;

  const frame = parseInteger(extractValue(line, "frame=")) ?? 0;
  const fps = parseNumber(extractValue(line, "fps=")) ?? 0;
  const speed = extractValue(line, "speed=") ?? "";
  const timeSeconds = parseTimeString(extractValue(line, "time=") ?? "") ?? 0;
  const percent =
    totalSeconds > 0 ? Math.min((timeSeconds / totalSeconds) * 100, 100) : 0;
  const speedFactor = parseNumber(speed.endsWith("x") ? speed.slice(0, -1) : speed) ?? 0;
  const eta_seconds =
    speedFactor > 0 && totalSeconds > timeSeconds
      ? (totalSeconds - timeSeconds) / speedFactor
      : null;

  return {
    percent,
    frame,
    fps,
    speed,
    eta_seconds,
  };
}

export function parseTimeString(value: string): number | null {
  const parts = value.split(":");
  if (parts.length !== 3) return null;

  const [hours, minutes, seconds] = parts.map(Number);
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;

  return hours * 3600 + minutes * 60 + seconds;
}

export function totalTimelineDurationUs(project: Project): number {
  return project.timeline.tracks.reduce((max, track) => {
    const trackMax = track.items.reduce(
      (itemMax, item) => Math.max(itemMax, timelineEndUs(item)),
      0,
    );
    return Math.max(max, trackMax);
  }, 0);
}

function compilePipOverlays(
  project: Project,
  pathToIndex: Map<string, number>,
  baseLabel: string,
  outLabel: string,
  pipClips: VideoClipItem[],
): string {
  const pipWidth = Math.trunc(project.settings.width / 4);
  const pipHeight = Math.trunc(project.settings.height / 4);
  const pipX = project.settings.width - pipWidth - 20;
  const pipY = project.settings.height - pipHeight - 20;
  const filters: string[] = [];
  let currentLabel = baseLabel;

  pipClips.forEach((clip, index) => {
    const data = clip.VideoClip;
    const asset = requireAsset(project.assets, data.asset_id);
    const inputIndex = requireInputIndex(pathToIndex, asset.path);
    const startSeconds = usToSeconds(data.source_in_us);
    const endSeconds = usToSeconds(data.source_out_us);
    const timelineStartSeconds = usToSeconds(data.timeline_start_us);
    const timelineEndSeconds = timelineStartSeconds + endSeconds - startSeconds;
    const scaledLabel = `pip_scaled_${index}`;
    const nextLabel = index === pipClips.length - 1 ? outLabel : `pip_${index}`;

    filters.push(
      `[${inputIndex}:v]trim=start=${startSeconds}:end=${endSeconds},setpts=PTS-STARTPTS,scale=${pipWidth}:${pipHeight}[${scaledLabel}]`,
    );
    filters.push(
      `[${currentLabel}][${scaledLabel}]overlay=x=${pipX}:y=${pipY}:enable='between(t,${timelineStartSeconds},${timelineEndSeconds})'[${nextLabel}]`,
    );

    currentLabel = nextLabel;
  });

  return filters.join(";");
}

function registerInput(
  project: Project,
  item: TimelineItem,
  pathToIndex: Map<string, number>,
  inputs: RenderInput[],
): void {
  const assetId = assetIdOf(item);
  if (!assetId) return;

  const asset = requireAsset(project.assets, assetId);
  if (pathToIndex.has(asset.path)) return;

  const index = inputs.length;
  pathToIndex.set(asset.path, index);
  inputs.push({ path: asset.path, index });
}

function isVideoClip(item: TimelineItem): item is VideoClipItem {
  return itemVariant(item) === "VideoClip";
}

function isAudioClip(item: TimelineItem): item is AudioClipItem {
  return itemVariant(item) === "AudioClip";
}

function isImageOverlay(item: TimelineItem): item is ImageOverlayItem {
  return itemVariant(item) === "ImageOverlay";
}

function isTextOverlay(item: TimelineItem): item is TextOverlayItem {
  return itemVariant(item) === "TextOverlay";
}

function executeRenderPlan(
  plan: RenderPlan,
  totalSeconds: number,
  onProgress: ExportOptions["onProgress"],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", buildFfmpegArgs(plan), {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderrTail: string[] = [];
    let progressBuffer = "";

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new Error("ffmpeg not found"));
        return;
      }
      reject(error);
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderrTail.push(chunk);
      if (stderrTail.length > 20) stderrTail.shift();

      progressBuffer += chunk;
      const segments = progressBuffer.split(/[\r\n]/);
      progressBuffer = segments.pop() ?? "";
      for (const segment of segments) {
        const progress = parseProgress(segment.trim(), totalSeconds);
        if (progress) onProgress?.(progress);
      }
    });

    child.on("close", (code, signal) => {
      const progress = parseProgress(progressBuffer.trim(), totalSeconds);
      if (progress) onProgress?.(progress);

      if (code === 0) {
        resolve();
        return;
      }

      const status = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(new Error(`ffmpeg failed with ${status}: ${stderrTail.join("").trim()}`));
    });
  });
}

function requireAsset(assets: Asset[], assetId: string): Asset {
  const asset = assets.find((candidate) => candidate.id === assetId);
  if (!asset) throw new Error(`Asset not found: ${assetId}`);
  return asset;
}

function requireInputIndex(pathToIndex: Map<string, number>, path: string): number {
  const index = pathToIndex.get(path);
  if (index === undefined) throw new Error(`Input not found: ${path}`);
  return index;
}

function usToSeconds(value: number): number {
  return value / 1_000_000;
}

function escapeDrawtext(value: string): string {
  return value.replaceAll("'", "'\\''");
}

function extractValue(line: string, key: string): string | null {
  const start = line.indexOf(key);
  if (start === -1) return null;

  const rest = line.slice(start + key.length).trimStart();
  const end = rest.search(/\s/);
  const value = end === -1 ? rest : rest.slice(0, end);
  return value.length > 0 ? value : null;
}

function parseInteger(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
