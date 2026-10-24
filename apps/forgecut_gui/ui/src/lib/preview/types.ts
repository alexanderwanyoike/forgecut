import type { Project } from "../../../electron/shared/ipc-contract";

export interface PreviewProps {
  project?: Project;
  projectVersion: number;
  playheadUs: number;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  onPlayheadChange: (us: number) => void;
}
