import { createHash, randomUUID } from "node:crypto";
import type { Result } from "../shared/result.js";
import type { JobRequest, JobSnapshot } from "../shared/jobs.js";

type Runner = (
  signal: AbortSignal,
  report: (progress: number) => void,
  beginCommit: () => boolean,
) => Promise<Result<unknown>>;
type Entry = {
  snapshot: JobSnapshot;
  fingerprint: string;
  controller: AbortController;
  timedOut?: boolean;
};

export class JobQueue {
  private entries = new Map<string, Entry>();

  private pending: { entry: Entry; run: Runner }[] = [];

  private running = false;

  private closed = false;

  private idle: Promise<void> = Promise.resolve();

  constructor(private readonly options: { timeoutMs?: number } = {}) {}

  start(request: JobRequest, run: Runner): Result<JobSnapshot> {
    if (this.closed)
      return {
        ok: false,
        error: {
          code: "QUEUE_CLOSED",
          message: "The media job queue is shutting down.",
        },
      };
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(request))
      .digest("hex");
    const existing = [...this.entries.values()].find(
      (entry) =>
        entry.snapshot.sessionId === request.sessionId &&
        entry.snapshot.requestId === request.requestId,
    );
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        return {
          ok: false,
          error: {
            code: "REQUEST_REUSED",
            message: "Job request ID was used for a different input.",
          },
        };
      return { ok: true, value: structuredClone(existing.snapshot) };
    }
    if (this.pending.length + Number(this.running) >= 16)
      return {
        ok: false,
        error: {
          code: "QUEUE_FULL",
          message: "The media job queue is full. Wait for a job or cancel one.",
        },
      };
    const snapshot: JobSnapshot = {
      id: randomUUID(),
      sessionId: request.sessionId,
      projectRevision: request.projectRevision,
      requestId: request.requestId,
      kind: request.kind,
      label: request.label,
      status: "queued",
      progress: 0,
      result: null,
    };
    const entry = { snapshot, fingerprint, controller: new AbortController() };
    this.entries.set(snapshot.id, entry);
    this.pending.push({ entry, run });
    if (!this.running) this.idle = this.drain();
    return { ok: true, value: structuredClone(snapshot) };
  }

  read(id: string, sessionId: string): Result<JobSnapshot> {
    const entry = this.entries.get(id);
    if (!entry)
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Job not found or no longer retained.",
        },
      };
    if (entry.snapshot.sessionId !== sessionId)
      return {
        ok: false,
        error: {
          code: "PROJECT_CHANGED",
          message: "Job belongs to another project session.",
        },
      };
    return { ok: true, value: structuredClone(entry.snapshot) };
  }

  cancel(id: string, sessionId: string): Result<JobSnapshot> {
    const found = this.read(id, sessionId);
    if (!found.ok) return found;
    const entry = this.entries.get(id)!;
    if (entry.snapshot.status === "committing")
      return {
        ok: false,
        error: {
          code: "COMMITTING",
          message:
            "The completed output is being published. Poll for completion.",
        },
      };
    if (entry.snapshot.status === "queued") {
      this.pending = this.pending.filter((work) => work.entry !== entry);
      entry.snapshot.status = "cancelled";
      entry.snapshot.result = {
        ok: false,
        error: {
          code: "CANCELLED",
          message: "Job cancelled before it started.",
        },
      };
    } else if (entry.snapshot.status === "running") {
      entry.snapshot.status = "cancelling";
      entry.controller.abort();
    }
    this.prune();
    return { ok: true, value: structuredClone(entry.snapshot) };
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const entry of [...this.entries.values()]) {
      if (["queued", "running", "cancelling"].includes(entry.snapshot.status))
        this.cancel(entry.snapshot.id, entry.snapshot.sessionId);
    }
    await this.idle;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.pending.length > 0) {
      const work = this.pending.shift()!;
      work.entry.snapshot.status = "running";
      const timeout = setTimeout(
        () => {
          if (work.entry.snapshot.status === "committing") return;
          work.entry.timedOut = true;
          work.entry.controller.abort();
        },
        this.options.timeoutMs ??
          (work.entry.snapshot.kind === "export" ? 900000 : 120000),
      );
      timeout.unref();
      try {
        const result = await work.run(
          work.entry.controller.signal,
          (progress) => {
            if (
              Number.isFinite(progress) &&
              !work.entry.controller.signal.aborted
            )
              work.entry.snapshot.progress = Math.max(
                work.entry.snapshot.progress,
                Math.min(0.99, Math.max(0, progress)),
              );
          },
          () => {
            if (work.entry.controller.signal.aborted) return false;
            work.entry.snapshot.status = "committing";
            return true;
          },
        );
        if (result.ok) work.entry.snapshot.progress = 1;
        work.entry.snapshot.result = result;
        work.entry.snapshot.status = result.ok ? "completed" : "failed";
      } catch (error) {
        work.entry.snapshot.result = {
          ok: false,
          error: {
            code: "JOB_FAILED",
            message: error instanceof Error ? error.message : String(error),
          },
        };
        work.entry.snapshot.status = "failed";
      }
      clearTimeout(timeout);
      if (work.entry.controller.signal.aborted) {
        const outcome = work.entry.snapshot.result;
        let message = work.entry.timedOut ? "Job deadline exceeded." : "Job cancelled.";
        if (outcome && !outcome.ok) {
          if (!work.entry.timedOut && outcome.error.code === "CANCELLED") message = outcome.error.message;
          else message = `${message} ${outcome.error.message}`;
        }
        work.entry.snapshot.status = work.entry.timedOut
          ? "failed"
          : "cancelled";
        work.entry.snapshot.result = {
          ok: false,
          error: {
            code: work.entry.timedOut ? "TIMEOUT" : "CANCELLED",
            message,
          },
        };
      }
      this.prune();
    }
    this.running = false;
  }

  private prune(): void {
    let bytes = [...this.entries.values()].reduce(
      (sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry.snapshot)),
      0,
    );
    for (const [id, entry] of this.entries) {
      if (this.entries.size <= 64 && bytes <= 8 * 1024 * 1024) break;
      if (
        entry.snapshot.status === "completed" ||
        entry.snapshot.status === "failed" ||
        entry.snapshot.status === "cancelled"
      ) {
        bytes -= Buffer.byteLength(JSON.stringify(entry.snapshot));
        this.entries.delete(id);
      }
    }
  }
}
