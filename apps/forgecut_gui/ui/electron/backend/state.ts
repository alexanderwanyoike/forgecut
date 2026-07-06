import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

export type TimeUs = number;

export type ProjectSettings = {
  width: number;
  height: number;
  fps: number;
  sample_rate: number;
};

export type Timeline = {
  tracks: Track[];
  markers: unknown[];
};

export type Track = {
  id: string;
  kind: "Video" | "Audio" | "OverlayImage" | "OverlayText";
  items: TimelineItem[];
};

export type TimelineItem =
  | { VideoClip: ClipItem }
  | { AudioClip: ClipItem & { volume: number } }
  | {
      ImageOverlay: {
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
    }
  | {
      TextOverlay: {
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
    };

type ClipItem = {
  id: string;
  asset_id: string;
  track_id: string;
  timeline_start_us: TimeUs;
  source_in_us: TimeUs;
  source_out_us: TimeUs;
};

export type Project = {
  id: string;
  name: string;
  settings: ProjectSettings;
  assets: unknown[];
  timeline: Timeline;
};

export class AppState {
  project = createProject("Untitled");

  createProject(): Project {
    this.project = createProject("Untitled");
    return this.project;
  }

  async saveProject(path: string): Promise<void> {
    await writeFile(path, `${JSON.stringify(this.project, null, 2)}\n`, "utf8");
  }

  async loadProject(path: string): Promise<Project> {
    const content = await readFile(path, "utf8");
    this.project = JSON.parse(content) as Project;
    return this.project;
  }

  initDefaultTracks(): Timeline {
    if (this.project.timeline.tracks.length === 0) {
      this.project.timeline.tracks.push({
        id: randomUUID(),
        kind: "Video",
        items: [],
      });
      this.project.timeline.tracks.push({
        id: randomUUID(),
        kind: "Audio",
        items: [],
      });
    }
    return this.project.timeline;
  }

  async autosave(): Promise<void> {
    const autosaveDir = join(tmpdir(), "forgecut-autosave");
    await mkdir(autosaveDir, { recursive: true });

    const path = join(
      autosaveDir,
      `autosave-${Math.floor(Date.now() / 1000)}.forgecut`,
    );
    await this.saveProject(path);

    const entries = (await readdir(autosaveDir))
      .filter((entry) => entry.startsWith("autosave-"))
      .sort()
      .reverse();

    await Promise.all(
      entries.slice(5).map((entry) =>
        rm(join(autosaveDir, entry), { force: true }),
      ),
    );
  }
}

function createProject(name: string): Project {
  return {
    id: randomUUID(),
    name,
    settings: {
      width: 1920,
      height: 1080,
      fps: 30,
      sample_rate: 48000,
    },
    assets: [],
    timeline: {
      tracks: [],
      markers: [],
    },
  };
}
