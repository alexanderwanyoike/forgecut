import type { GraphicPromotionRequest } from "./graphic-promotion.js";
import type { GraphicDraft } from "./graphic-draft.js";
import type { GraphicPreviewFrame } from "./graphic-preview.js";
import type {
  GraphicDiagnostic,
  GraphicCompilation,
} from "./graphic-source.js";
import type {
  GraphicResource,
  GraphicResourceImport,
  GraphicResourceSelection,
} from "./graphic-resources.js";
import type {
  GraphicComponent,
  GraphicValues,
  RemotionGraphicItem,
  GraphicLayerStates,
} from "./graphics.js";
import type { JobSnapshot } from "./jobs.js";
/**
 * Single source of truth for the renderer <-> main IPC surface.
 *
 * Imported by the Electron backend (runtime) and by the renderer bridge
 * (types only). Keep this file free of runtime imports so both TypeScript projects
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

export type TrackKind =
  "Video" | "Audio" | "OverlayImage" | "OverlayText" | "Graphics";

export type AudioSettings = {
  volume?: number;
  muted?: boolean;
  fade_in_us?: TimeUs;
  fade_out_us?: TimeUs;
};

export type ClipItem = {
  id: string;
  asset_id: string;
  track_id: string;
  timeline_start_us: TimeUs;
  source_in_us: TimeUs;
  source_out_us: TimeUs;
} & AudioSettings;

export type VisualPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
  fit: "contain" | "cover";
  opacity: number;
};

export type VideoClipItem = ClipItem & {
  transform?: VisualPlacement;
  layer_order?: number;
};

export type ImageOverlayItem = {
  fit?: VisualPlacement["fit"];
  layer_order?: number;
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
  layer_order?: number;
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
  | { RemotionGraphic: RemotionGraphicItem }
  | { VideoClip: VideoClipItem }
  | { AudioClip: ClipItem & { volume: number } }
  | { ImageOverlay: ImageOverlayItem }
  | { TextOverlay: TextOverlayItem };

export type TimelineItemDetail =
  | RemotionGraphicItem
  | VideoClipItem
  | (ClipItem & { volume: number })
  | ImageOverlayItem
  | TextOverlayItem;

export type TimelineItemVariant =
  | "VideoClip"
  | "AudioClip"
  | "ImageOverlay"
  | "TextOverlay"
  | "RemotionGraphic";

export type Track = {
  id: string;
  kind: TrackKind;
  items: TimelineItem[];
};

export type Timeline = {
  duration_us?: TimeUs;
  tracks: Track[];
  markers: unknown[];
};

export type ProjectSequence = {
  id: string;
  name: string;
  settings: ProjectSettings;
  timeline: Timeline;
};

export type Project = {
  schema_version?: 2 | 3;
  default_sequence?: Pick<ProjectSequence, "id" | "name">;
  sequences?: ProjectSequence[];
  components?: GraphicComponent[];
  resources?: GraphicResource[];
  id: string;
  name: string;
  settings: ProjectSettings;
  assets: Asset[];
  timeline: Timeline;
};

export type McpStatus = {
  available: boolean;
  statusRevision: number;
  lastAction: string | null;
};

export type EditingContext = {
  sessionId: string;
  contextRevision: number;
  selectedItemIds: string[];
  selectedLayerIds: string[];
  playheadUs: TimeUs;
};

export type ProjectSnapshot = {
  project: Project;
  sessionId: string;
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
  missingMedia: string[];
  changedItemIds?: string[];
};
export type SequenceFrame = {
  frame: number;
  frameCount: number;
  durationUs: TimeUs;
  settings: ProjectSettings;
  layers: {
    item: TimelineItem;
    trackIndex: number;
    asset: Asset | null;
    sourceTimeUs?: TimeUs;
    playbackTimeUs?: TimeUs;
    audioGain?: number;
    placement?: VisualPlacement;
  }[];
};

export type EditErrorCode =
  | "UNAVAILABLE"
  | "RENDER_FAILED"
  | "TIMEOUT"
  | "COMMITTING"
  | "CANCELLED"
  | "INVALID_INPUT"
  | "CONFLICT"
  | "PROJECT_CHANGED"
  | "NOT_FOUND"
  | "IO_ERROR"
  | "NOTHING_TO_UNDO"
  | "REQUEST_REUSED";
export type CommandResponse<T = unknown> =
  | { ok: true; value: T; sessionId: string; revision: number }
  | {
      ok: false;
      error: {
        code: EditErrorCode;
        message: string;
        diagnostics?: GraphicDiagnostic[];
      };
    };

export type CommandMetadata = { sessionId?: string; editGroup?: string };

export type ItemPatch =
  | {
      kind: "RemotionGraphic";
      changes: {
        props?: GraphicValues;
        layer_states?: GraphicLayerStates;
        transform?: VisualPlacement;
        layer_order?: number;
      };
    }
  | {
      kind: "VideoClip";
      changes: AudioSettings &
        Partial<Pick<VideoClipItem, "transform" | "layer_order">>;
    }
  | {
      kind: "AudioClip";
      changes: AudioSettings;
    }
  | {
      kind: "TextOverlay";
      changes: Partial<
        Pick<
          TextOverlayItem,
          "text" | "font_size" | "color" | "x" | "y" | "layer_order"
        >
      >;
    }
  | {
      kind: "ImageOverlay";
      changes: Partial<
        Pick<
          ImageOverlayItem,
          | "asset_id"
          | "x"
          | "y"
          | "width"
          | "height"
          | "opacity"
          | "fit"
          | "layer_order"
        >
      >;
    };

export type EditCommandName =
  | "create_sequence"
  | "rename_sequence"
  | "delete_sequence"
  | "add_graphic_item"
  | "set_sequence_end"
  | "add_clip_to_timeline"
  | "trim_clip"
  | "split_clip"
  | "delete_clip"
  | "move_clip"
  | "move_clip_to_track"
  | "add_track"
  | "add_text_overlay"
  | "add_image_overlay"
  | "set_clip_volume"
  | "update_item"
  | "remove_asset"
  | "update_project";
export type EditOperation = {
  [K in EditCommandName]: { command: K; args: CommandMap[K]["args"] };
}[EditCommandName];
export type EditRequest = {
  sessionId: string;
  expectedRevision: number;
  requestId: string;
  editGroup?: string;
  operations: EditOperation[];
};

export type HistoryRequest = Pick<
  EditRequest,
  "sessionId" | "expectedRevision" | "requestId"
> & { direction: "undo" | "redo" };

export type Thumbnail = {
  time_seconds: number;
  data_uri: string;
};

export type WaveformData = {
  peaks: [number, number][];
  sample_rate: number;
  samples_per_peak: number;
};

/**
 * Every IPC command with its argument and result shape.
 * `args: undefined` means the command takes no arguments.
 */
export type CommandMap = {
  delete_sequence: { args: { sequenceId: string }; result: undefined };
  get_sequences: {
    args: undefined;
    result: Omit<ProjectSequence, "timeline">[];
  };
  rename_sequence: {
    args: { sequenceId: string; name: string };
    result: ProjectSequence;
  };
  create_sequence: {
    args: { name: string; settings?: Partial<ProjectSettings> };
    result: ProjectSequence;
  };
  start_graphic_promotion: {
    args: GraphicPromotionRequest;
    result: JobSnapshot;
  };
  get_graphic_type_libraries: {
    args: undefined;
    result: Record<string, string>;
  };
  get_graphic_draft_preview: {
    args: Omit<GraphicPromotionRequest, "scope" | "requestId"> & {
      frame: number;
    };
    result: GraphicPreviewFrame;
  };
  get_graphic_draft: { args: { itemId: string }; result: GraphicDraft };
  save_graphic_draft: {
    args: {
      itemId: string;
      sessionId: string;
      expectedDraftRevision: number;
      baseVersion: string;
      component: GraphicComponent;
    };
    result: GraphicDraft;
  };
  revert_graphic_draft: {
    args: { itemId: string; sessionId: string; expectedDraftRevision: number };
    result: GraphicDraft;
  };
  get_graphic_preview: {
    args: { itemId: string; frame: number; props?: GraphicValues };
    result: GraphicPreviewFrame;
  };
  check_graphic_source: {
    args: {
      source: GraphicComponent["source"];
      properties?: GraphicComponent["properties"];
    };
    result: GraphicCompilation;
  };
  // Project
  create_project: { args: undefined; result: string };
  save_project: { args: { path: string }; result: void };
  load_project: { args: { path: string }; result: string };
  get_project_settings: { args: undefined; result: ProjectSettings };
  get_project_snapshot: { args: undefined; result: ProjectSnapshot };
  get_editing_context: { args: undefined; result: EditingContext };
  set_editing_context: {
    args: {
      sessionId: string;
      selectedItemIds: string[];
      selectedLayerIds?: string[];
      playheadUs: TimeUs;
    };
    result: EditingContext;
  };
  apply_edits: { args: EditRequest; result: ProjectSnapshot };
  apply_history: { args: HistoryRequest; result: ProjectSnapshot };
  update_project: {
    args: { name?: string; settings?: Partial<ProjectSettings> };
    result: Project;
  };
  recover_project: { args: { path: string }; result: string };
  autosave: { args: undefined; result: void };

  // Timeline
  import_graphic_resource: {
    args: GraphicResourceImport & {
      target?: GraphicResourceSelection & {
        sessionId: string;
        expectedRevision: number;
      };
    };
    result: GraphicResource;
  };
  get_graphic_components: { args: undefined; result: GraphicComponent[] };
  add_graphic_item: {
    args: {
      templateId: string;
      trackId: string;
      timelineStartUs: TimeUs;
      durationUs: TimeUs;
      props?: GraphicValues;
    };
    result: Timeline;
  };
  set_sequence_end: { args: { endUs: TimeUs | null }; result: Timeline };
  get_timeline: { args: undefined; result: Timeline };
  init_default_tracks: { args: undefined; result: Timeline };
  add_clip_to_timeline: {
    args: {
      assetId: string;
      trackId: string;
      timelineStartUs: TimeUs;
      sourceInUs?: TimeUs;
      sourceOutUs?: TimeUs;
    };
    result: Timeline;
  };
  trim_clip: {
    args: { itemId: string; trimType: "in" | "out"; newUs: TimeUs };
    result: Timeline;
  };
  split_clip: {
    args: { itemId: string; splitTimeUs: TimeUs };
    result: Timeline;
  };
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
  get_sequence_frame: { args: { playheadUs: TimeUs }; result: SequenceFrame };
  set_clip_volume: {
    args: { itemId: string; volume: number };
    result: Timeline;
  };
  get_item_details: { args: { itemId: string }; result: TimelineItem };
  update_item: {
    args: { itemId: string; patch: ItemPatch };
    result: Timeline;
  };

  // Media
  import_assets: { args: { paths: string[] }; result: Asset[] };
  get_assets: { args: undefined; result: Asset[] };
  remove_asset: { args: { id: string }; result: void };
  relink_asset: { args: { id: string; path: string }; result: Asset };
  get_clip_thumbnails: { args: { assetId: string }; result: Thumbnail[] };
  get_waveform: { args: { assetId: string }; result: WaveformData };

  // Export jobs
  cancel_media_job: {
    args: { sessionId: string; jobId: string };
    result: JobSnapshot;
  };
  get_media_job: {
    args: { sessionId: string; jobId: string };
    result: JobSnapshot;
  };
  export_project: { args: { outputPath: string }; result: JobSnapshot };
};

export type CommandName = keyof CommandMap;

export type CommandArgsOf<K extends CommandName> = CommandMap[K]["args"];
export type CommandResultOf<K extends CommandName> = CommandMap[K]["result"];

/**
 * Payloads pushed from main to the renderer over the events channel.
 * The preload bridge prefixes names with "forgecut:event:" on the wire.
 */
export type EventPayloads = {
  "project-changed": ProjectSnapshot;
  "mcp-status": McpStatus;
};

export type EventSink = <E extends keyof EventPayloads>(
  event: E,
  payload: EventPayloads[E],
) => void;
