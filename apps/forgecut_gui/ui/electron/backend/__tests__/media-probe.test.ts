/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  createAssetFromProbe,
  detectAssetKind,
  parseFrameRate,
  parseProbeOutput,
} from "../media-probe";
import type { ProbeResult } from "../state";

const emptyProbe: ProbeResult = {
  duration_us: 0,
  width: 0,
  height: 0,
  fps: 0,
  codec: "",
  audio_channels: 0,
  audio_sample_rate: 0,
};

describe("Electron media probe helpers", () => {
  it("parses fractional and plain frame rates", () => {
    expect(parseFrameRate("30000/1001")).toBeCloseTo(29.97, 2);
    expect(parseFrameRate("30/1")).toBe(30);
    expect(parseFrameRate("24/1")).toBe(24);
    expect(parseFrameRate("29.97")).toBeCloseTo(29.97, 2);
    expect(parseFrameRate("30/0")).toBeUndefined();
  });

  it("detects kind by extension before probe data", () => {
    expect(detectAssetKind("photo.png", emptyProbe)).toBe("Image");
    expect(detectAssetKind("song.mp3", emptyProbe)).toBe("Audio");
    expect(detectAssetKind("PHOTO.JPG", emptyProbe)).toBe("Image");
  });

  it("detects kind by probe data for unknown extensions", () => {
    expect(
      detectAssetKind("clip.unknown", {
        ...emptyProbe,
        width: 1920,
        height: 1080,
        audio_channels: 2,
      }),
    ).toBe("Video");
    expect(
      detectAssetKind("track.unknown", {
        ...emptyProbe,
        codec: "aac",
        audio_channels: 2,
        audio_sample_rate: 44100,
      }),
    ).toBe("Audio");
  });

  it("parses video and audio ffprobe output", () => {
    const result = parseProbeOutput({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          r_frame_rate: "30/1",
        },
        {
          codec_type: "audio",
          codec_name: "aac",
          channels: 2,
          sample_rate: "48000",
        },
      ],
      format: { duration: "10.5" },
    });

    expect(result).toEqual({
      duration_us: 10_500_000,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "h264",
      audio_channels: 2,
      audio_sample_rate: 48000,
    });
  });

  it("parses audio-only ffprobe output", () => {
    const result = parseProbeOutput({
      streams: [
        {
          codec_type: "audio",
          codec_name: "mp3",
          channels: 2,
          sample_rate: "44100",
        },
      ],
      format: { duration: "180.0" },
    });

    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
    expect(result.fps).toBe(0);
    expect(result.codec).toBe("mp3");
    expect(result.audio_channels).toBe(2);
    expect(result.audio_sample_rate).toBe(44100);
    expect(result.duration_us).toBe(180_000_000);
  });

  it("handles missing streams and format", () => {
    expect(parseProbeOutput({ streams: [], format: {} })).toEqual(emptyProbe);
  });

  it("creates asset records with the expected JSON shape", () => {
    const asset = createAssetFromProbe("/media/clip.mp4", {
      ...emptyProbe,
      duration_us: 1_000_000,
      width: 1920,
      height: 1080,
    });

    expect(asset).toMatchObject({
      name: "clip.mp4",
      path: "/media/clip.mp4",
      kind: "Video",
      probe: {
        duration_us: 1_000_000,
        width: 1920,
        height: 1080,
      },
    });
    expect(asset.id).toEqual(expect.any(String));
  });
});
