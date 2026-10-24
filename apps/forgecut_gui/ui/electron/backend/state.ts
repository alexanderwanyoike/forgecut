import { access, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";

import { atomicWrite, readIfPresent } from "./atomic-file.js";
import { validateProject } from "./project-schema.js";
import { EditingError } from "./editing-error.js";
import type {
  ProjectSnapshot,
  ClipItem,
  ImageOverlayItem,
  Project,
  TextOverlayItem,
  Timeline,
} from "../shared/ipc-contract.js";

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

type ProjectSnapshotEntry = {
  before: Project;
  after: Project;
  group?: string;
  bytes: number;
};

type ChangeOptions = { group?: string; availablePaths?: string[] };
type HistoryLimits = { count?: number; bytes?: number };

export class AppState {
  private currentProject = freezeProject(createProject("Untitled"));
  get project(): Project {
    return this.currentProject;
  }
  sessionId = randomUUID();
  revision = 0;
  private undoStack: ProjectSnapshotEntry[] = [];
  private redoStack: ProjectSnapshotEntry[] = [];
  private listeners = new Set<(snapshot: ProjectSnapshot) => void>();
  private missingMedia = new Set<string>();
  private saveQueue: Promise<void> = Promise.resolve();
  private readonly maxHistorySize: number;
  private readonly maxHistoryBytes: number;

  constructor(limits: HistoryLimits = {}, initialProject?: Project) {
    if (initialProject)
      this.currentProject = freezeProject(validateProject(initialProject));
    this.maxHistorySize = limits.count ?? 100;
    this.maxHistoryBytes = limits.bytes ?? 32 * 1024 * 1024;
  }

  snapshot(): ProjectSnapshot {
    return {
      project: structuredClone(this.project),
      sessionId: this.sessionId,
      revision: this.revision,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      missingMedia: this.project.assets
        .filter((asset) => this.missingMedia.has(asset.path))
        .map((asset) => asset.id),
    };
  }

  subscribe(listener: (snapshot: ProjectSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  assertSession(sessionId: string): void {
    if (sessionId !== this.sessionId)
      throw new EditingError(
        "PROJECT_CHANGED",
        "The project changed. Read the current project and try again.",
      );
  }

  createProject(): Project {
    this.missingMedia.clear();
    this.replaceProject(createProject("Untitled"));
    return this.project;
  }

  saveProject(path: string): Promise<void> {
    const outputPath = ensureForgeCutExtension(path);
    const content = `${JSON.stringify(validateProject(this.project), null, 2)}\n`;
    const save = this.saveQueue.then(async () => {
      const previous = await readIfPresent(outputPath);
      if (previous !== undefined) {
        // A corrupt primary must not replace the last known valid recovery file.
        let valid = false;
        try {
          validateProject(JSON.parse(previous));
          valid = true;
        } catch {}
        if (valid) await atomicWrite(`${outputPath}.bak`, previous);
      }
      await atomicWrite(outputPath, content);
    });
    this.saveQueue = save.catch(() => {});
    return save;
  }

  async loadProject(path: string, recovery = false): Promise<Project> {
    const sessionId = this.sessionId;
    const revision = this.revision;
    const content = await readFile(
      recovery ? `${ensureForgeCutExtension(path)}.bak` : path,
      "utf8",
    );
    const project = validateProject(JSON.parse(content));
    const missing = new Set<string>();
    await Promise.all(
      project.assets.map(async (asset) => {
        try {
          await access(asset.path);
        } catch {
          missing.add(asset.path);
        }
      }),
    );
    this.assertSession(sessionId);
    if (revision !== this.revision)
      throw new EditingError(
        "CONFLICT",
        "The project was edited while loading. Try opening it again.",
      );
    this.missingMedia = missing;
    this.replaceProject(project);
    return this.project;
  }

  initDefaultTracks(): Timeline {
    if (this.project.timeline.tracks.length === 0) {
      this.executeProjectChange((project) => {
        project.timeline.tracks.push({
          id: randomUUID(),
          kind: "Video",
          items: [],
        });
        project.timeline.tracks.push({
          id: randomUUID(),
          kind: "Audio",
          items: [],
        });
      });
    }
    return this.project.timeline;
  }

  executeProjectChange(
    mutator: (project: Project) => void,
    options: ChangeOptions = {},
  ): Project {
    const before = this.project;
    const draft = structuredClone(before);
    mutator(draft);
    const after = validateProject(draft);
    const mediaRestored = options.availablePaths?.some((path) =>
      this.missingMedia.has(path),
    );
    if (JSON.stringify(before) === JSON.stringify(after)) {
      if (mediaRestored) {
        options.availablePaths?.forEach((path) =>
          this.missingMedia.delete(path),
        );
        this.changed();
      }
      return this.project;
    }
    const previous = this.undoStack.at(-1);
    const entryBefore =
      options.group &&
      previous?.group === options.group &&
      this.redoStack.length === 0
        ? previous.before
        : before;
    const entry = {
      before: structuredClone(entryBefore),
      after: structuredClone(after),
      group: options.group,
      bytes:
        Buffer.byteLength(JSON.stringify(entryBefore)) +
        Buffer.byteLength(JSON.stringify(after)),
    };
    if (entryBefore !== before) this.undoStack.pop();
    this.undoStack.push(entry);
    this.redoStack = [];
    this.currentProject = freezeProject(after);
    options.availablePaths?.forEach((path) => this.missingMedia.delete(path));
    this.trimHistory();
    this.changed();
    return this.project;
  }

  executeTimelineChange(mutator: (timeline: Timeline) => void): Timeline {
    this.executeProjectChange((project) => mutator(project.timeline));
    return this.project.timeline;
  }

  undo(): Timeline {
    const entry = this.undoStack.pop();
    if (!entry) throw new EditingError("NOTHING_TO_UNDO", "Nothing to undo");
    this.currentProject = freezeProject(structuredClone(entry.before));
    this.redoStack.push({ ...entry, group: undefined });
    this.changed();
    return this.project.timeline;
  }

  redo(): Timeline {
    const entry = this.redoStack.pop();
    if (!entry) throw new EditingError("NOTHING_TO_UNDO", "Nothing to redo");
    this.currentProject = freezeProject(structuredClone(entry.after));
    this.undoStack.push({ ...entry, group: undefined });
    this.changed();
    return this.project.timeline;
  }

  async autosave(): Promise<void> {
    const autosaveDir = join(tmpdir(), "forgecut-autosave");
    await mkdir(autosaveDir, { recursive: true });
    const prefix = `autosave-${createHash("sha256").update(this.project.id).digest("hex")}-`;
    await this.saveProject(
      join(autosaveDir, `${prefix}${Date.now()}-${randomUUID()}.forgecut`),
    );
    const entries = (await readdir(autosaveDir))
      .filter(
        (entry) => entry.startsWith(prefix) && entry.endsWith(".forgecut"),
      )
      .sort()
      .reverse();
    await Promise.all(
      entries
        .slice(5)
        .map((entry) => rm(join(autosaveDir, entry), { force: true })),
    );
  }

  private replaceProject(project: Project): void {
    this.currentProject = freezeProject(project);
    this.sessionId = randomUUID();
    this.undoStack = [];
    this.redoStack = [];
    this.changed();
  }

  private trimHistory(): void {
    let bytes = this.undoStack.reduce((total, entry) => total + entry.bytes, 0);
    while (
      this.undoStack.length > this.maxHistorySize ||
      bytes > this.maxHistoryBytes
    ) {
      bytes -= this.undoStack.shift()!.bytes;
    }
  }

  private changed(): void {
    this.revision += 1;
    for (const listener of this.listeners) {
      // Notifications cannot turn a successful commit into a reported failure.
      try {
        listener(this.snapshot());
      } catch (error) {
        console.error("Project listener failed", error);
      }
    }
  }
}

function createProject(name: string): Project {
  return {
    schema_version: 1,
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

function ensureForgeCutExtension(path: string): string {
  return extname(path) === ".forgecut" ? path : `${path}.forgecut`;
}

function freezeProject<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeProject);
    Object.freeze(value);
  }
  return value;
}
