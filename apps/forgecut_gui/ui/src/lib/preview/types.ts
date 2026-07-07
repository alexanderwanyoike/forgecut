import type {
  ImageOverlayItem,
  TextOverlayItem,
} from "../../../electron/shared/ipc-contract";

export type { ClipAtPlayhead } from "../../../electron/shared/ipc-contract";

/** Overlay shape as consumed by the preview surface (variant fields optional). */
export interface OverlayData {
  ImageOverlay?: ImageOverlayItem & { file_path?: string };
  TextOverlay?: TextOverlayItem;
}

export interface PreviewProps {
  playheadUs: number;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  onPlayheadChange: (us: number) => void;
}
