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

function sourceReads(args: string[]) {
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
  return reads;
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
    const { spans } = compileExportPlan(project);
    expect(spans.map((span) => sourceReads(buildFfmpegArgs(span)))).toEqual([
      [{ start: "20", duration: "2" }],
      [{ start: "1", duration: "3" }],
    ]);
  });

  it("renders back-to-back clips on one track as plain cuts without compositing", () => {
    const project = baseProject([
      {
        id: videoTrackId,
        kind: "Video",
        items: [
          videoClip(),
          videoClip({ id: "second", timeline_start_us: 4_000_000 }),
        ],
      },
    ]);
    const { spans } = compileExportPlan(project);
    expect(spans).toHaveLength(2);
    for (const span of spans) {
      expect(span.inputs).toHaveLength(1);
      expect(span.filterGraph).not.toContain("overlay");
      expect(span.filterGraph).toMatch(
        /scale=1920:1080:force_original_aspect_ratio=decrease.*pad=1920:1080/,
      );
      expect(span.outputArgs).toEqual(
        expect.arrayContaining(["-frames:v", "120"]),
      );
    }
    expect(spans.map((span) => span.offsetSeconds)).toEqual([0, 4]);
  });

  it("composites only the span a title covers and resumes the clip after it", () => {
    const project = baseProject([
      { id: videoTrackId, kind: "Video", items: [videoClip()] },
      {
        id: "track-text",
        kind: "OverlayText",
        items: [
          {
            TextOverlay: {
              id: "title",
              track_id: "track-text",
              timeline_start_us: 1_000_000,
              duration_us: 1_000_000,
              text: "Title",
              font_size: 48,
              color: "#ffffff",
              x: 0,
              y: 0,
            },
          },
        ],
      },
    ]);
    const { spans } = compileExportPlan(project);
    expect(spans.map((span) => span.filterGraph.includes("overlay"))).toEqual([
      false,
      true,
      false,
    ]);
    expect(spans[1].filterGraph).toContain("drawtext");
    // Mid-clip spans seek to a whole second at least a second before their first frame.
    expect(spans.map((span) => sourceReads(buildFfmpegArgs(span)))).toEqual([
      [{ start: "1", duration: "4" }],
      [{ start: "1", duration: "4" }],
      [{ start: "2", duration: "3" }],
    ]);
  });

  it("opens only the clips a review range overlaps and seeks them on the input side", () => {
    const long = { source_in_us: 1_000_000, source_out_us: 25_000_000 };
    const project = baseProject([
      {
        id: videoTrackId,
        kind: "Video",
        items: [
          videoClip(long),
          videoClip({ ...long, id: "second", timeline_start_us: 24_000_000 }),
          videoClip({ ...long, id: "third", timeline_start_us: 48_000_000 }),
        ],
      },
    ]);
    const plan = compileExportPlan(project, {
      startSeconds: 30,
      durationSeconds: 1,
      frameCount: 30,
    });
    expect(plan.spans).toHaveLength(1);
    const [span] = plan.spans;
    expect(sourceReads(buildFfmpegArgs(span))).toEqual([
      { start: "6", duration: "19" },
    ]);
    expect(span.filterGraph).toContain("trim=start_frame=30,");
    const muxArgs = buildFfmpegArgs(plan.mux);
    expect(sourceReads(muxArgs).slice(1)).toEqual([
      { start: "7", duration: "18" },
    ]);
    for (const args of [buildFfmpegArgs(span), muxArgs])
      expect(args.slice(args.indexOf("-filter_complex"))).not.toContain("-ss");
    expect(plan.mux.filterGraph).toContain("asetpts=PTS-STARTPTS+6/TB");
  });

  it("joins span files with the concat demuxer and copies their video", () => {
    const project = baseProject([
      {
        id: videoTrackId,
        kind: "Video",
        items: [
          videoClip(),
          videoClip({ id: "second", timeline_start_us: 4_000_000 }),
        ],
      },
    ]);
    const plan = compileExportPlan(project, undefined, "mp4", "/tmp/stage");
    expect(plan.spans.map((span) => span.outputPath)).toEqual([
      "/tmp/stage/span-0.mp4",
      "/tmp/stage/span-1.mp4",
    ]);
    expect(plan.mux.textFiles).toEqual([
      { name: "spans.txt", content: "file 'span-0.mp4'\nfile 'span-1.mp4'\n" },
    ]);
    const args = buildFfmpegArgs(plan.mux);
    const concat = args.indexOf("/tmp/stage/spans.txt");
    expect(args.slice(concat - 3, concat)).toEqual(["-f", "concat", "-i"]);
    expect(args).toEqual(
      expect.arrayContaining(["-map", "0:v", "-c:v", "copy"]),
    );
    expect(args).toContain("[outa]");
    expect(args.at(-1)).toBe("/tmp/stage/render.mp4");
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
