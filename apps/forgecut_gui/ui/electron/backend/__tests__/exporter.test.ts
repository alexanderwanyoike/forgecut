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

function baseProject(tracks: Track[], assets: Asset[] = [videoAsset()]): Project {
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
  it("compiles a primary video track into trim and concat filters", () => {
    const project = baseProject([
      { id: videoTrackId, kind: "Video", items: [videoClip()] },
    ]);

    const plan = compileExportPlan(project);

    expect(plan.inputs).toEqual([{ path: "/tmp/clip.mp4", index: 0 }]);
    expect(plan.filterGraph).toContain(
      "[0:v]trim=start=1:end=5,setpts=PTS-STARTPTS[v0]",
    );
    expect(plan.filterGraph).toContain(
      "[0:a]atrim=start=1:end=5,asetpts=PTS-STARTPTS[a0]",
    );
    expect(plan.filterGraph).toContain("[v0][a0]concat=n=1:v=1:a=1[outv][outa]");
  });

  it("deduplicates repeated assets while preserving concat order", () => {
    const project = baseProject([
      {
        id: videoTrackId,
        kind: "Video",
        items: [
          videoClip({ id: "clip-a", source_in_us: 0, source_out_us: 3_000_000 }),
          videoClip({
            id: "clip-b",
            timeline_start_us: 3_000_000,
            source_in_us: 5_000_000,
            source_out_us: 8_000_000,
          }),
        ],
      },
    ]);

    const plan = compileExportPlan(project);

    expect(plan.inputs).toHaveLength(1);
    expect(plan.filterGraph).toContain("[v0][a0][v1][a1]concat=n=2:v=1:a=1");
  });

  it("adds scaling when source dimensions differ from project settings", () => {
    const project = baseProject(
      [{ id: videoTrackId, kind: "Video", items: [videoClip()] }],
      [
        videoAsset({
          probe: {
            duration_us: 30_000_000,
            width: 1280,
            height: 720,
            fps: 30,
            codec: "h264",
            audio_channels: 2,
            audio_sample_rate: 48000,
          },
        }),
      ],
    );

    const plan = compileExportPlan(project);

    expect(plan.filterGraph).toContain(
      "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
    );
  });

  it("mixes audio overlays with timeline delay and fades", () => {
    const audioAsset: Asset = {
      id: "asset-audio",
      name: "music.mp3",
      path: "/tmp/music.mp3",
      kind: "Audio",
      probe: {
        duration_us: 60_000_000,
        width: 0,
        height: 0,
        fps: 0,
        codec: "mp3",
        audio_channels: 2,
        audio_sample_rate: 44100,
      },
    };
    const project = baseProject(
      [
        { id: videoTrackId, kind: "Video", items: [videoClip()] },
        {
          id: "track-audio",
          kind: "Audio",
          items: [
            {
              AudioClip: {
                id: "audio",
                asset_id: "asset-audio",
                track_id: "track-audio",
                timeline_start_us: 2_000_000,
                source_in_us: 0,
                source_out_us: 8_000_000,
                volume: 0.5,
              },
            },
          ],
        },
      ],
      [videoAsset(), audioAsset],
    );

    const plan = compileExportPlan(project);

    expect(plan.inputs).toHaveLength(2);
    expect(plan.filterGraph).toContain("[concat_a]");
    expect(plan.filterGraph).toContain("volume=0.5");
    expect(plan.filterGraph).toContain("afade=t=in:d=0.1");
    expect(plan.filterGraph).toContain("adelay=2000|2000");
    expect(plan.filterGraph).toContain("amix=inputs=2:duration=longest");
  });

  it("chains PiP, image, and text overlays", () => {
    const pipTrackId = "track-pip";
    const imageAsset: Asset = {
      id: "asset-image",
      name: "logo.png",
      path: "/tmp/logo.png",
      kind: "Image",
      probe: null,
    };
    const project = baseProject(
      [
        { id: videoTrackId, kind: "Video", items: [videoClip()] },
        {
          id: pipTrackId,
          kind: "Video",
          items: [
            videoClip({
              id: "pip",
              track_id: pipTrackId,
              timeline_start_us: 2_000_000,
              source_in_us: 0,
              source_out_us: 2_000_000,
            }),
          ],
        },
        {
          id: "track-image",
          kind: "OverlayImage",
          items: [
            {
              ImageOverlay: {
                id: "image",
                asset_id: "asset-image",
                track_id: "track-image",
                timeline_start_us: 1_000_000,
                duration_us: 3_000_000,
                x: 100,
                y: 200,
                width: 320,
                height: 240,
                opacity: 0.75,
              },
            },
          ],
        },
        {
          id: "track-text",
          kind: "OverlayText",
          items: [
            {
              TextOverlay: {
                id: "text",
                track_id: "track-text",
                timeline_start_us: 1_500_000,
                duration_us: 2_000_000,
                text: "Hello",
                font_size: 48,
                color: "#ffffff",
                x: 10,
                y: 20,
              },
            },
          ],
        },
      ],
      [videoAsset(), imageAsset],
    );

    const plan = compileExportPlan(project);

    expect(plan.filterGraph).toContain("overlay=x=1420:y=790");
    expect(plan.filterGraph).toContain("[1:v]scale=320:240[img_scaled_0]");
    expect(plan.filterGraph).toContain("colorchannelmixer=aa=0.75");
    expect(plan.filterGraph).toContain("drawtext=text='Hello'");
    expect(plan.outputArgs).toContain("[outv_txt]");
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
