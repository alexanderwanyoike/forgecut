export interface ClipAtPlayhead {
  file_path: string;
  seek_seconds: number;
  clip_start_us: number;
  clip_end_us: number;
  source_in_us: number;
}

export interface OverlayData {
  ImageOverlay?: {
    file_path: string;
    x: number;
    y: number;
    width: number;
    height: number;
    opacity: number;
  };
  TextOverlay?: {
    text: string;
    font_size: number;
    color: string;
    x: number;
    y: number;
  };
}

export interface PreviewProps {
  playheadUs: number;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  onPlayheadChange: (us: number) => void;
}
