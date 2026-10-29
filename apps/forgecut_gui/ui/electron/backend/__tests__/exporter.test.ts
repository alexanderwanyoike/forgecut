/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  buildFfmpegArgs,
  compileExportPlan,
  parseProgress,
  parseTimeString,
  totalTimelineDurationUs,
} from "../exporter";
import type { Asset, Project, Track } from "../state";

const videoTrackId = "track-video";

function videoAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "asset-video",
    name: "clip.mp4",
    path: "/tmp/clip.mp4",
    kind: "Video",
    probe: {
      duration_us: 30_000_000,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "h264",
      audio_channels: 2,
      audio_sample_rate: 48000,
    },
    ...overrides,
  };
}

function baseProject(
  tracks: Track[],
  assets: Asset[] = [videoAsset()],
): Project {
  return {
    id: "project",
    name: "Test",
    settings: {
      width: 1920,
      height: 1080,
      fps: 30,
      sample_rate: 48000,
    },
    assets,
    timeline: {
      tracks,
      markers: [],
    },
  };
}

function videoClip(overrides = {}) {
  return {
    VideoClip: {
      id: "clip",
      asset_id: "asset-video",
      track_id: videoTrackId,
      timeline_start_us: 0,
      source_in_us: 1_000_000,
      source_out_us: 5_000_000,
      ...overrides,
    },
  };
}

describe("Electron export planner", () => {
  it("bounds recording reads to each selected range when cuts reverse source order", () => {
    const project = baseProject([
      {
        id: videoTrackId,
        kind: "Video",
        items: [
          videoClip({ source_in_us: 20_000_000, source_out_us: 22_000_000 }),
          videoClip({
            id: "earlier-shot",
            timeline_start_us: 2_000_000,
            source_in_us: 1_000_000,
            source_out_us: 4_000_000,
          }),
        ],
      },
    ]);
    const args = buildFfmpegArgs(compileExportPlan(project));
    const reads: { start: string | undefined; duration: string | undefined }[] =
      [];
    let start: string | undefined;
    let duration: string | undefined;
    for (let index = 0; index < args.indexOf("-filter_complex"); index += 1) {
      if (args[index] === "-ss") start = args[index + 1];
      if (args[index] === "-t") duration = args[index + 1];
      if (args[index] === "-i") {
        reads.push({ start, duration });
        start = undefined;
        duration = undefined;
      }
    }
    expect(reads).toEqual([
      { start: "20", duration: "2" },
      { start: "1", duration: "3" },
    ]);
  });

  it("builds ffmpeg args from a render plan", () => {
    const project = baseProject([
      { id: videoTrackId, kind: "Video", items: [videoClip()] },
    ]);
    const plan = compileExportPlan(project);
    plan.outputPath = "/tmp/out.mp4";

    const args = buildFfmpegArgs(plan);

    expect(args[0]).toBe("-y");
    expect(args).toContain("-filter_complex");
    expect(args).toContain("[outv]");
    expect(args).toContain("[outa]");
    expect(args.at(-1)).toBe("/tmp/out.mp4");
  });

  it("calculates total duration across all timeline tracks", () => {
    const project = baseProject([
      { id: videoTrackId, kind: "Video", items: [videoClip()] },
      {
        id: "track-text",
        kind: "OverlayText",
        items: [
          {
            TextOverlay: {
              id: "text",
              track_id: "track-text",
              timeline_start_us: 8_000_000,
              duration_us: 2_000_000,
              text: "End card",
              font_size: 48,
              color: "#ffffff",
              x: 0,
              y: 0,
            },
          },
        ],
      },
    ]);

    expect(totalTimelineDurationUs(project)).toBe(10_000_000);
  });
});

describe("Electron export progress parsing", () => {
  it("extracts progress fields and ETA from ffmpeg output", () => {
    const progress = parseProgress(
      "frame=  150 fps= 30 q=28.0 size=1024kB time=00:00:05.00 bitrate=200.0kbits/s speed=1.50x",
      10,
    );

    expect(progress?.frame).toBe(150);
    expect(progress?.fps).toBe(30);
    expect(progress?.percent).toBeCloseTo(50, 1);
    expect(progress?.speed).toBe("1.50x");
    expect(progress?.eta_seconds).toBeCloseTo(3.33, 1);
  });

  it("ignores non-progress lines", () => {
    expect(parseProgress("Input #0, mov,mp4...", 10)).toBeNull();
  });

  it("parses ffmpeg timestamp strings", () => {
    expect(parseTimeString("00:01:02.05")).toBeCloseTo(62.05, 3);
    expect(parseTimeString("01:00:00.00")).toBe(3600);
    expect(parseTimeString("invalid")).toBeNull();
  });
});
