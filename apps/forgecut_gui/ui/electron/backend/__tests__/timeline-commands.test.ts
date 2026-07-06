/**
 * @vitest-environment node
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { projectCommands } from "../commands/project";
import { timelineCommands } from "../commands/timeline";
import { AppState, type Asset, type Timeline } from "../state";
import type { CommandContext } from "../ipc";

function context(state = new AppState()): CommandContext {
  return { state, webContents: {} as CommandContext["webContents"] };
}

function videoAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "asset-video",
    name: "clip.mp4",
    path: "/media/clip.mp4",
    kind: "Video",
    probe: {
      duration_us: 10_000_000,
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

function timelineFrom(commandResult: unknown): Timeline {
  return commandResult as Timeline;
}

describe("Electron project commands", () => {
  it("saves pretty JSON with a .forgecut extension when missing", async () => {
    const state = new AppState();
    const dir = await mkdtemp(join(tmpdir(), "forgecut-project-"));
    const basePath = join(dir, "project");

    await projectCommands.save_project({ path: basePath }, context(state));

    const saved = await readFile(`${basePath}.forgecut`, "utf8");
    expect(JSON.parse(saved).name).toBe("Untitled");
    expect(saved).toContain("\n  ");
  });

  it("load_project resets timeline history", async () => {
    const state = new AppState();
    const ctx = context(state);
    const dir = await mkdtemp(join(tmpdir(), "forgecut-load-"));
    const path = join(dir, "project.forgecut");

    await projectCommands.save_project({ path }, ctx);
    timelineCommands.init_default_tracks(undefined, ctx);
    timelineCommands.add_track({ kind: "Video" }, ctx);
    expect(() => timelineCommands.undo(undefined, ctx)).not.toThrow();

    await projectCommands.load_project({ path }, ctx);
    expect(() => timelineCommands.undo(undefined, ctx)).toThrow("Nothing to undo");
  });
});

describe("Electron timeline commands", () => {
  it("initializes default video and audio tracks once", () => {
    const ctx = context();

    const first = timelineFrom(timelineCommands.init_default_tracks(undefined, ctx));
    const second = timelineFrom(timelineCommands.init_default_tracks(undefined, ctx));

    expect(first.tracks.map((track) => track.kind)).toEqual(["Video", "Audio"]);
    expect(second.tracks).toHaveLength(2);
  });

  it("adds, trims, undoes, and redoes a video clip", () => {
    const state = new AppState();
    state.project.assets.push(videoAsset());
    const ctx = context(state);
    const timeline = timelineFrom(timelineCommands.init_default_tracks(undefined, ctx));
    const videoTrackId = timeline.tracks[0].id;

    const afterAdd = timelineFrom(
      timelineCommands.add_clip_to_timeline(
        { assetId: "asset-video", trackId: videoTrackId, timelineStartUs: 0 },
        ctx,
      ),
    );
    const clip = afterAdd.tracks[0].items[0].VideoClip;
    expect(clip.source_out_us).toBe(10_000_000);

    const afterTrim = timelineFrom(
      timelineCommands.trim_clip(
        { itemId: clip.id, trimType: "in", newUs: 2_000_000 },
        ctx,
      ),
    );
    expect(afterTrim.tracks[0].items[0].VideoClip.timeline_start_us).toBe(2_000_000);
    expect(afterTrim.tracks[0].items[0].VideoClip.source_in_us).toBe(2_000_000);

    const afterUndo = timelineFrom(timelineCommands.undo(undefined, ctx));
    expect(afterUndo.tracks[0].items[0].VideoClip.timeline_start_us).toBe(0);
    expect(afterUndo.tracks[0].items[0].VideoClip.source_in_us).toBe(0);

    const afterRedo = timelineFrom(timelineCommands.redo(undefined, ctx));
    expect(afterRedo.tracks[0].items[0].VideoClip.source_in_us).toBe(2_000_000);
  });

  it("rejects overlapping moves and preserves the original item position", () => {
    const state = new AppState();
    state.project.assets.push(videoAsset());
    const ctx = context(state);
    const timeline = timelineFrom(timelineCommands.init_default_tracks(undefined, ctx));
    const videoTrackId = timeline.tracks[0].id;

    timelineCommands.add_clip_to_timeline(
      { assetId: "asset-video", trackId: videoTrackId, timelineStartUs: 0 },
      ctx,
    );
    const afterSecond = timelineFrom(
      timelineCommands.add_clip_to_timeline(
        { assetId: "asset-video", trackId: videoTrackId, timelineStartUs: 10_000_000 },
        ctx,
      ),
    );
    const secondClipId = afterSecond.tracks[0].items[1].VideoClip.id;

    expect(() =>
      timelineCommands.move_clip(
        { itemId: secondClipId, newStartUs: 5_000_000 },
        ctx,
      ),
    ).toThrow("Overlap detected");
    expect(state.project.timeline.tracks[0].items[1].VideoClip.timeline_start_us).toBe(10_000_000);
  });

  it("collects snap points while excluding the dragged item", () => {
    const state = new AppState();
    state.project.assets.push(videoAsset({ probe: { ...videoAsset().probe!, duration_us: 3_000_000 } }));
    const ctx = context(state);
    const timeline = timelineFrom(timelineCommands.init_default_tracks(undefined, ctx));
    const trackId = timeline.tracks[0].id;

    const afterFirst = timelineFrom(
      timelineCommands.add_clip_to_timeline(
        { assetId: "asset-video", trackId, timelineStartUs: 1_000_000 },
        ctx,
      ),
    );
    const firstClipId = afterFirst.tracks[0].items[0].VideoClip.id;
    timelineCommands.add_clip_to_timeline(
      { assetId: "asset-video", trackId, timelineStartUs: 5_000_000 },
      ctx,
    );

    expect(
      timelineCommands.get_snap_points({ excludeItemId: firstClipId }, ctx),
    ).toEqual([0, 5_000_000, 8_000_000]);
  });

  it("finds the active clip and source seek position at the playhead", () => {
    const state = new AppState();
    state.project.assets.push(videoAsset());
    const ctx = context(state);
    const timeline = timelineFrom(timelineCommands.init_default_tracks(undefined, ctx));
    const trackId = timeline.tracks[0].id;
    const afterAdd = timelineFrom(
      timelineCommands.add_clip_to_timeline(
        { assetId: "asset-video", trackId, timelineStartUs: 1_000_000 },
        ctx,
      ),
    );
    const clipId = afterAdd.tracks[0].items[0].VideoClip.id;
    timelineCommands.trim_clip({ itemId: clipId, trimType: "in", newUs: 2_000_000 }, ctx);

    expect(timelineCommands.get_clip_at_playhead({ playheadUs: 3_000_000 }, ctx)).toMatchObject({
      file_path: "/media/clip.mp4",
      seek_seconds: 2,
      clip_start_us: 3_000_000,
      source_in_us: 2_000_000,
    });
  });
});
