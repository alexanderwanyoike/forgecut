/**
 * Single source of truth for the renderer <-> main IPC surface.
 *
 * Imported by the Electron backend (runtime) and by the renderer bridge
 * (types only). Keep this file free of imports so both TypeScript projects
 * can consume it unchanged. Field names are snake_case where they are
 * serialized into `.forgecut` project files.
 */

export type TimeUs = number;

export type ProjectSettings = {
  width: number;
  height: number;
  fps: number;
  sample_rate: number;
};

export type AssetKind = "Video" | "Audio" | "Image";

export type ProbeResult = {
  duration_us: TimeUs;
  width: number;
  height: number;
  fps: number;
  codec: string;
  audio_channels: number;
  audio_sample_rate: number;
};

export type Asset = {
  id: string;
  name: string;
  path: string;
  kind: AssetKind;
  probe: ProbeResult | null;
};

export type TrackKind = "Video" | "Audio" | "OverlayImage" | "OverlayText";

export type ClipItem = {
  id: string;
  asset_id: string;
  track_id: string;
  timeline_start_us: TimeUs;
  source_in_us: TimeUs;
  source_out_us: TimeUs;
};

export type ImageOverlayItem = {
  id: string;
  asset_id: string;
  track_id: string;
  timeline_start_us: TimeUs;
  duration_us: TimeUs;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
};

export type TextOverlayItem = {
  id: string;
  track_id: string;
  timeline_start_us: TimeUs;
  duration_us: TimeUs;
  text: string;
  font_size: number;
  color: string;
  x: number;
  y: number;
};

export type TimelineItem =
  | { VideoClip: ClipItem }
  | { AudioClip: ClipItem & { volume: number } }
  | { ImageOverlay: ImageOverlayItem }
  | { TextOverlay: TextOverlayItem };

export type TimelineItemVariant = "VideoClip" | "AudioClip" | "ImageOverlay" | "TextOverlay";

export type Track = {
  id: string;
  kind: TrackKind;
  items: TimelineItem[];
};

export type Timeline = {
  tracks: Track[];
  markers: unknown[];
};

export type Project = {
  id: string;
  name: string;
  settings: ProjectSettings;
  assets: Asset[];
  timeline: Timeline;
};

export type ClipAtPlayhead = {
  file_path: string;
  seek_seconds: number;
  clip_start_us: TimeUs;
  clip_end_us: TimeUs;
  source_in_us: TimeUs;
};

/** Overlay items resolved for preview; asset-backed overlays gain file_path. */
export type OverlayAtTime =
  | { ImageOverlay: ImageOverlayItem & { file_path?: string } }
  | { TextOverlay: TextOverlayItem };

export type Thumbnail = {
  time_seconds: number;
  data_uri: string;
};

export type WaveformData = {
  peaks: [number, number][];
  sample_rate: number;
  samples_per_peak: number;
};

export type RenderProgress = {
  percent: number;
  frame: number;
  fps: number;
  speed: string;
  eta_seconds: number | null;
};

/**
 * Every IPC command with its argument and result shape.
 * `args: undefined` means the command takes no arguments.
 */
export type CommandMap = {
  // Project
  create_project: { args: undefined; result: string };
  save_project: { args: { path: string }; result: void };
  load_project: { args: { path: string }; result: string };
  get_project_settings: { args: undefined; result: ProjectSettings };
  autosave: { args: undefined; result: void };

  // Timeline
  get_timeline: { args: undefined; result: Timeline };
  init_default_tracks: { args: undefined; result: Timeline };
  add_clip_to_timeline: {
    args: { assetId: string; trackId: string; timelineStartUs: TimeUs };
    result: Timeline;
  };
  trim_clip: {
    args: { itemId: string; trimType: "in" | "out"; newUs: TimeUs };
    result: Timeline;
  };
  split_clip: { args: { itemId: string; splitTimeUs: TimeUs }; result: Timeline };
  delete_clip: { args: { itemId: string }; result: Timeline };
  move_clip: { args: { itemId: string; newStartUs: TimeUs }; result: Timeline };
  move_clip_to_track: {
    args: { itemId: string; newTrackId: string; newStartUs: TimeUs };
    result: Timeline;
  };
  undo: { args: undefined; result: Timeline };
  redo: { args: undefined; result: Timeline };
  add_track: { args: { kind: TrackKind }; result: Timeline };
  add_text_overlay: {
    args: {
      trackId: string;
      timelineStartUs: TimeUs;
      durationUs: TimeUs;
      text: string;
      fontSize: number;
      color: string;
      x: number;
      y: number;
    };
    result: Timeline;
  };
  add_image_overlay: {
    args: {
      assetId: string;
      timelineStartUs: TimeUs;
      durationUs: TimeUs;
      x: number;
      y: number;
      width: number;
      height: number;
      opacity: number;
    };
    result: Timeline;
  };
  get_snap_points: { args: { excludeItemId?: string }; result: TimeUs[] };
  get_clip_at_playhead: { args: { playheadUs: TimeUs }; result: ClipAtPlayhead | null };
  get_overlays_at_time: { args: { playheadUs: TimeUs }; result: OverlayAtTime[] };
  set_clip_volume: { args: { itemId: string; volume: number }; result: Timeline };
  get_item_details: { args: { itemId: string }; result: TimelineItem };
  update_item_property: {
    args: { itemId: string; property: string; value: unknown };
    result: Timeline;
  };

  // Media
  import_assets: { args: { paths: string[] }; result: Asset[] };
  get_assets: { args: undefined; result: Asset[] };
  remove_asset: { args: { id: string }; result: void };
  get_clip_thumbnails: { args: { assetId: string }; result: Thumbnail[] };
  get_waveform: { args: { assetId: string }; result: WaveformData };

  // Export (progress arrives via forgecut:event:export-progress events)
  export_project: { args: { outputPath: string }; result: void };
};

export type CommandName = keyof CommandMap;

export type CommandArgsOf<K extends CommandName> = CommandMap[K]["args"];
export type CommandResultOf<K extends CommandName> = CommandMap[K]["result"];

/**
 * Payloads pushed from main to the renderer over the events channel.
 * The preload bridge prefixes names with "forgecut:event:" on the wire.
 */
export type EventPayloads = {
  "export-progress": RenderProgress;
  "export-complete": { output_path: string };
};
