import { execFile } from "node:child_process";
import { basename, extname } from "node:path";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { Asset, AssetKind, ProbeResult } from "./state.js";

const execFileAsync = promisify(execFile);

type FfprobeOutput = {
  streams?: FfprobeStream[];
  format?: {
    duration?: string;
  };
};

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  channels?: number;
  sample_rate?: string;
};

export async function importAsset(path: string): Promise<Asset> {
  const probe = await probeAsset(path);
  return createAssetFromProbe(path, probe);
}

export async function probeAsset(path: string): Promise<ProbeResult> {
  try {
    await stat(path);
  } catch {
    throw new Error(`File not found: ${path}`);
  }

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("ffprobe", [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      path,
    ]));
  } catch (error) {
    throw new Error(`ffprobe failed: ${String(error)}`);
  }

  return parseProbeOutput(JSON.parse(stdout) as FfprobeOutput);
}

export function createAssetFromProbe(path: string, probe: ProbeResult): Asset {
  return {
    id: randomUUID(),
    name: basename(path) || "unknown",
    path,
    kind: detectAssetKind(path, probe),
    probe,
  };
}

export function parseProbeOutput(output: FfprobeOutput): ProbeResult {
  const streams = output.streams ?? [];
  const videoStream = streams.find((stream) => stream.codec_type === "video");
  const audioStream = streams.find((stream) => stream.codec_type === "audio");

  return {
    duration_us: secondsToUs(parseNumber(output.format?.duration) ?? 0),
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    fps: parseFrameRate(videoStream?.r_frame_rate) ?? 0,
    codec: videoStream?.codec_name ?? audioStream?.codec_name ?? "",
    audio_channels: audioStream?.channels ?? 0,
    audio_sample_rate: parseInteger(audioStream?.sample_rate) ?? 0,
  };
}

export function parseFrameRate(rate: string | undefined): number | undefined {
  if (!rate) return undefined;
  const [numerator, denominator] = rate.split("/");
  if (denominator !== undefined) {
    const n = Number(numerator);
    const d = Number(denominator);
    if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) {
      return undefined;
    }
    return n / d;
  }

  const value = Number(rate);
  return Number.isFinite(value) ? value : undefined;
}

export function detectAssetKind(path: string, probe: ProbeResult): AssetKind {
  const extension = extname(path).slice(1).toLowerCase();

  if (["png", "jpg", "jpeg", "gif", "bmp", "webp", "tiff", "svg"].includes(extension)) {
    return "Image";
  }

  if (["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma"].includes(extension)) {
    return "Audio";
  }

  if (probe.width > 0 && probe.height > 0) {
    return "Video";
  }

  if (probe.audio_channels > 0) {
    return "Audio";
  }

  return "Video";
}

function secondsToUs(seconds: number): number {
  return Math.trunc(seconds * 1_000_000);
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
