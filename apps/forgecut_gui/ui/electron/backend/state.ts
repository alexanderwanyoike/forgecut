import { access, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import {
  projectSequences,
  findProjectSequence,
  projectForSequence,
} from "../domain/project-sequences.js";
import type {
  EditingContext,
  CommandMap,
  ProjectSnapshot,
  ProjectSequence,
  Project,
  Timeline,
} from "../shared/ipc-contract.js";
import { itemData } from "./timeline-ops.js";
import { SessionContext } from "./session-context.js";
import { ProjectHistory } from "./project-history.js";
import type { HistoryChange, HistoryLimits } from "./project-history.js";

import {
  saveGraphicResources,
  loadGraphicResources,
} from "./graphic-resource-persistence.js";
import { atomicWrite, readIfPresent } from "./atomic-file.js";
import { validateProject } from "./project-schema.js";
import { EditingError } from "./editing-error.js";

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
  TimelineItemDetail,
  Track,
} from "../shared/ipc-contract.js";

type ChangeOptions = HistoryChange & { availablePaths?: string[] };

export class AppState {
  private context = new SessionContext();

  private currentProject = freezeProject(createProject("Untitled"));

  get project(): Project {
    return this.currentProject;
  }

  sessionId = randomUUID();

  revision = 0;

  private readonly history: ProjectHistory;

  private listeners = new Set<(snapshot: ProjectSnapshot) => void>();

  private missingMedia = new Set<string>();

  private saveQueue: Promise<void> = Promise.resolve();

  constructor(limits: HistoryLimits = {}, initialProject?: Project) {
    if (initialProject)
      this.currentProject = freezeProject(validateProject(initialProject));
    this.context.selectSequence(projectSequences(this.project)[0].id);
    this.history = new ProjectHistory(limits);
  }

  get activeSequence(): ProjectSequence {
    const id =
      this.context.snapshot().activeSequenceId ??
      projectSequences(this.project)[0].id;
    return this.sequenceIn(this.project, id);
  }

  sequenceIn(
    project: Project,
    sequenceId = this.activeSequence.id,
  ): ProjectSequence {
    const found = findProjectSequence(project, sequenceId);
    if (!found.ok) throw new EditingError("NOT_FOUND", found.error.message);
    return found.value;
  }

  projectForSequence(sequenceId = this.activeSequence.id): Project {
    const found = projectForSequence(this.project, sequenceId);
    if (!found.ok) throw new EditingError("NOT_FOUND", found.error.message);
    return found.value;
  }

  selectSequence(sessionId: string, sequenceId: string): EditingContext {
    this.assertSession(sessionId);
    const found = findProjectSequence(this.project, sequenceId);
    if (!found.ok) throw new EditingError("NOT_FOUND", found.error.message);
    if (this.context.selectSequence(sequenceId)) {
      this.reconcileContext();
      this.notify();
    }
    return this.getEditingContext();
  }

  get undoSequenceId(): string | undefined {
    return this.history.undoSequenceId;
  }

  get redoSequenceId(): string | undefined {
    return this.history.redoSequenceId;
  }

  get canUndo(): boolean {
    return this.history.canUndo(this.activeSequence.id);
  }

  get canRedo(): boolean {
    return this.history.canRedo(this.activeSequence.id);
  }

  getEditingContext(): EditingContext {
    return {
      sessionId: this.sessionId,
      sequenceRevision: this.context.sequenceRevision,
      ...this.context.snapshot(),
    };
  }

  setEditingContext(
    input: CommandMap["set_editing_context"]["args"],
    sequenceId?: string,
  ): EditingContext {
    this.assertSession(input.sessionId);
    if (
      input.sequenceRevision !== undefined &&
      input.sequenceRevision !== this.context.sequenceRevision
    )
      throw new EditingError(
        "CONFLICT",
        "The sequence activation changed before this context update",
      );
    const requested = input.sequenceId ?? sequenceId;
    if (
      (input.sequenceId && sequenceId && input.sequenceId !== sequenceId) ||
      (requested && requested !== this.activeSequence.id)
    )
      throw new EditingError(
        "CONFLICT",
        "The active sequence changed before this context update",
      );
    if (!requested && (this.project.sequences?.length ?? 0) > 0)
      throw new EditingError(
        "INVALID_INPUT",
        "Provide a sequence ID before updating multi-sequence context",
      );
    const ids = new Set(
      this.activeSequence.timeline.tracks.flatMap((track) =>
        track.items.map((item) => itemData(item).id),
      ),
    );
    this.context.update(
      input.selectedItemIds.filter((id) => ids.has(id)),
      input.playheadUs,
      (input.selectedLayerIds ?? []).filter((id) =>
        this.selectedGraphicLayers(input.selectedItemIds).has(id),
      ),
    );
    return this.getEditingContext();
  }

  snapshot(): ProjectSnapshot {
    return {
      project: structuredClone(this.project),
      activeSequenceId: this.activeSequence.id,
      sequenceRevision: this.context.sequenceRevision,
      sessionId: this.sessionId,
      revision: this.revision,
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoSequenceId: this.undoSequenceId,
      redoSequenceId: this.redoSequenceId,
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
    const project = validateProject(this.project);
    const content = `${JSON.stringify(project, null, 2)}\n`;
    const save = this.saveQueue.then(async () => {
      await saveGraphicResources(project.resources ?? [], dirname(outputPath));
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
    const { sessionId } = this;
    const { revision } = this;
    const content = await readFile(
      recovery ? `${ensureForgeCutExtension(path)}.bak` : path,
      "utf8",
    );
    const project = validateProject(JSON.parse(content));
    await loadGraphicResources(project.resources ?? [], dirname(path));
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

  initDefaultTracks(sequenceId = this.activeSequence.id): Timeline {
    if (
      this.sequenceIn(this.project, sequenceId).timeline.tracks.length === 0
    ) {
      this.executeTimelineChange((timeline) => {
        timeline.tracks.push({ id: randomUUID(), kind: "Video", items: [] });
        timeline.tracks.push({ id: randomUUID(), kind: "Audio", items: [] });
      }, sequenceId);
    }
    return this.sequenceIn(this.project, sequenceId).timeline;
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
    this.history.record(before, after, options);
    this.currentProject = freezeProject(after);
    options.availablePaths?.forEach((path) => this.missingMedia.delete(path));
    this.changed();
    return this.project;
  }

  executeTimelineChange(
    mutator: (timeline: Timeline) => void,
    sequenceId = this.activeSequence.id,
  ): Timeline {
    this.executeProjectChange(
      (project) => mutator(this.sequenceIn(project, sequenceId).timeline),
      { sequenceId },
    );
    return this.sequenceIn(this.project, sequenceId).timeline;
  }

  undo(sequenceId = this.activeSequence.id): Timeline {
    const restored = this.history.undo(sequenceId);
    if (!restored.ok)
      throw new EditingError(restored.error.code, restored.error.message);
    this.currentProject = freezeProject(restored.value);
    this.changed();
    return this.activeSequence.timeline;
  }

  redo(sequenceId = this.activeSequence.id): Timeline {
    const restored = this.history.redo(sequenceId);
    if (!restored.ok)
      throw new EditingError(restored.error.code, restored.error.message);
    this.currentProject = freezeProject(restored.value);
    this.changed();
    return this.activeSequence.timeline;
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
    this.context.clear();
    this.currentProject = freezeProject(project);
    this.context.selectSequence(projectSequences(this.project)[0].id);
    this.sessionId = randomUUID();
    this.history.clear();
    this.changed();
  }

  private selectedGraphicLayers(itemIds: string[]): Set<string> {
    return new Set(
      this.activeSequence.timeline.tracks
        .flatMap((track) => track.items)
        .flatMap((item) => {
          if (
            !("RemotionGraphic" in item) ||
            !itemIds.includes(item.RemotionGraphic.id)
          )
            return [];
          const graphic = item.RemotionGraphic;
          return (
            this.project.components
              ?.find(
                (component) =>
                  component.id === graphic.component_id &&
                  component.version === graphic.component_version,
              )
              ?.layers.map((layer) => layer.id) ?? []
          );
        }),
    );
  }

  private reconcileContext(): void {
    const sequences = projectSequences(this.project);
    const active = this.context.snapshot().activeSequenceId;
    if (!sequences.some((sequence) => sequence.id === active))
      this.context.selectSequence(sequences[0].id);
    this.context.retainSequences(
      new Set(sequences.map((sequence) => sequence.id)),
    );
    this.context.reconcile(
      new Set(
        this.activeSequence.timeline.tracks.flatMap((track) =>
          track.items.map((item) => itemData(item).id),
        ),
      ),
      this.selectedGraphicLayers(this.context.snapshot().selectedItemIds),
    );
  }

  private changed(): void {
    this.reconcileContext();
    this.revision += 1;
    this.notify();
  }

  private notify(): void {
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
    schema_version: 4,
    source_selections: [],
    default_sequence: { id: randomUUID(), name: "Main" },
    sequences: [],
    resources: [],
    components: [],
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

export function ensureForgeCutExtension(path: string): string {
  return extname(path) === ".forgecut" ? path : `${path}.forgecut`;
}

function freezeProject<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeProject);
    Object.freeze(value);
  }
  return value;
}
