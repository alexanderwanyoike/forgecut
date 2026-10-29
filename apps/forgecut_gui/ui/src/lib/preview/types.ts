import type { Project } from "../../../electron/shared/ipc-contract";

export interface PreviewProps {
  project?: Project;
  sessionId?: string;
  selectedClipId?: string | null;
  selectedLayerId?: string | null;
  onGraphicSelection?: (itemId: string, layerId: string) => void;
  projectVersion: number;
  playheadUs: number;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  onPlayheadChange: (us: number) => void;
}
