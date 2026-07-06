import type { CommandRegistry } from "./types.js";

export const timelineCommands: CommandRegistry = {
  get_timeline: (_args, { state }) => state.project.timeline,
  init_default_tracks: (_args, { state }) => state.initDefaultTracks(),
  get_snap_points: () => [],
  get_clip_at_playhead: () => null,
  get_overlays_at_time: () => [],
};
