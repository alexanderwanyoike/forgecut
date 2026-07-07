import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import type { ClipItem, ImageOverlayItem, Project, TextOverlayItem, Timeline } from "../shared/ipc-contract.js";

// Domain types live in the shared IPC contract; re-export for backend modules.
export type {
  Asset,
  AssetKind,
  ClipItem,
  ImageOverlayItem,
  ProbeResult,
  Project,
  ProjectSettings,
  TextOverlayItem,
  TimeUs,
  Timeline,
  TimelineItem,
  TimelineItemVariant,
  Track,
} from "../shared/ipc-contract.js";

export type TimelineItemDetail =
  | ClipItem
  | (ClipItem & { volume: number })
  | ImageOverlayItem
  | TextOverlayItem;

type TimelineSnapshot = {
  before: Timeline;
  after: Timeline;
};

export class AppState {
  project = createProject("Untitled");
  private undoStack: TimelineSnapshot[] = [];
  private redoStack: TimelineSnapshot[] = [];
  private maxHistorySize = 100;

  createProject(): Project {
    this.project = createProject("Untitled");
    this.clearHistory();
    return this.project;
  }

  async saveProject(path: string): Promise<void> {
    const outputPath = ensureForgeCutExtension(path);
    await writeFile(outputPath, `${JSON.stringify(this.project, null, 2)}\n`, "utf8");
  }

  async loadProject(path: string): Promise<Project> {
    const content = await readFile(path, "utf8");
    this.project = JSON.parse(content) as Project;
    this.clearHistory();
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

  executeTimelineChange(mutator: (timeline: Timeline) => void): Timeline {
    const before = cloneTimeline(this.project.timeline);
    mutator(this.project.timeline);
    const after = cloneTimeline(this.project.timeline);

    this.redoStack = [];
    this.undoStack.push({ before, after });
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift();
    }

    return this.project.timeline;
  }

  undo(): Timeline {
    const snapshot = this.undoStack.pop();
    if (!snapshot) throw new Error("Nothing to undo");
    this.project.timeline = cloneTimeline(snapshot.before);
    this.redoStack.push(snapshot);
    return this.project.timeline;
  }

  redo(): Timeline {
    const snapshot = this.redoStack.pop();
    if (!snapshot) throw new Error("Nothing to redo");
    this.project.timeline = cloneTimeline(snapshot.after);
    this.undoStack.push(snapshot);
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

  private clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
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

function cloneTimeline(timeline: Timeline): Timeline {
  return structuredClone(timeline);
}

function ensureForgeCutExtension(path: string): string {
  return extname(path) === ".forgecut" ? path : `${path}.forgecut`;
}
