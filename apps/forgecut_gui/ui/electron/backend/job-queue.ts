import { createHash, randomUUID } from "node:crypto";
import type { Result } from "../shared/result.js";
import type { JobRequest, JobSnapshot } from "../shared/jobs.js";

type Runner = (signal: AbortSignal) => Promise<Result<unknown>>;
type Entry = {
  snapshot: JobSnapshot;
  fingerprint: string;
  controller: AbortController;
};

export class JobQueue {
  private entries = new Map<string, Entry>();

  private pending: { entry: Entry; run: Runner }[] = [];

  private running = false;

  start(request: JobRequest, run: Runner): Result<JobSnapshot> {
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
      result: null,
    };
    const entry = { snapshot, fingerprint, controller: new AbortController() };
    this.entries.set(snapshot.id, entry);
    this.pending.push({ entry, run });
    void this.drain();
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
    return { ok: true, value: structuredClone(entry.snapshot) };
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.pending.length > 0) {
      const work = this.pending.shift()!;
      work.entry.snapshot.status = "running";
      try {
        const result = await work.run(work.entry.controller.signal);
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
      if (work.entry.controller.signal.aborted) {
        work.entry.snapshot.status = "cancelled";
        work.entry.snapshot.result = {
          ok: false,
          error: { code: "CANCELLED", message: "Job cancelled." },
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
