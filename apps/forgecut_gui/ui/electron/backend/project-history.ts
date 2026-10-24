import type { Project } from "../shared/ipc-contract.js";
import type { Result } from "../shared/result.js";

export type HistoryChange = { group?: string; sequenceId?: string };
export type HistoryLimits = { count?: number; bytes?: number };

type HistoryEntry = HistoryChange & {
  before: Project;
  after: Project;
  bytes: number;
};
type HistoryFailure = {
  code: "NOTHING_TO_UNDO" | "CONFLICT";
  message: string;
};

export class ProjectHistory {
  private undoStack: HistoryEntry[] = [];

  private redoStack: HistoryEntry[] = [];

  private readonly maxCount: number;

  private readonly maxBytes: number;

  constructor(limits: HistoryLimits = {}) {
    this.maxCount = limits.count ?? 100;
    this.maxBytes = limits.bytes ?? 32 * 1024 * 1024;
  }

  get undoSequenceId(): string | undefined {
    return this.undoStack.at(-1)?.sequenceId;
  }

  get redoSequenceId(): string | undefined {
    return this.redoStack.at(-1)?.sequenceId;
  }

  canUndo(sequenceId: string): boolean {
    return (
      this.undoStack.length > 0 &&
      (!this.undoSequenceId || this.undoSequenceId === sequenceId)
    );
  }

  canRedo(sequenceId: string): boolean {
    return (
      this.redoStack.length > 0 &&
      (!this.redoSequenceId || this.redoSequenceId === sequenceId)
    );
  }

  record(before: Project, after: Project, change: HistoryChange): void {
    const previous = this.undoStack.at(-1);
    const entryBefore =
      change.group &&
      previous?.group === change.group &&
      previous.sequenceId === change.sequenceId &&
      this.redoStack.length === 0
        ? previous.before
        : before;
    const entry = {
      before: structuredClone(entryBefore),
      after: structuredClone(after),
      group: change.group,
      sequenceId: change.sequenceId,
      bytes:
        Buffer.byteLength(JSON.stringify(entryBefore)) +
        Buffer.byteLength(JSON.stringify(after)),
    };
    if (entryBefore !== before) this.undoStack.pop();
    this.undoStack.push(entry);
    this.redoStack = [];
    this.trim();
  }

  undo(sequenceId: string): Result<Project, HistoryFailure> {
    return this.restore("undo", sequenceId);
  }

  redo(sequenceId: string): Result<Project, HistoryFailure> {
    return this.restore("redo", sequenceId);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  private restore(
    direction: "undo" | "redo",
    sequenceId: string,
  ): Result<Project, HistoryFailure> {
    const source = direction === "undo" ? this.undoStack : this.redoStack;
    const destination = direction === "undo" ? this.redoStack : this.undoStack;
    const entry = source.at(-1);
    if (!entry)
      return {
        ok: false,
        error: { code: "NOTHING_TO_UNDO", message: `Nothing to ${direction}` },
      };
    if (entry.sequenceId && entry.sequenceId !== sequenceId)
      return {
        ok: false,
        error: {
          code: "CONFLICT",
          message: "This history action belongs to a different sequence",
        },
      };
    const project = structuredClone(
      direction === "undo" ? entry.before : entry.after,
    );
    source.pop();
    destination.push({ ...entry, group: undefined });
    return { ok: true, value: project };
  }

  private trim(): void {
    let bytes = this.undoStack.reduce((total, entry) => total + entry.bytes, 0);
    while (this.undoStack.length > this.maxCount || bytes > this.maxBytes) {
      bytes -= this.undoStack.shift()!.bytes;
    }
  }
}
