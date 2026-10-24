import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { Result } from "../shared/result.js";
import type {
  GraphicPreviewInput,
  GraphicPreviewFrame,
} from "../shared/graphic-preview.js";
import { budgetedMediaCommand } from "./process-budget.js";
import { graphicSandboxArgs } from "./graphic-sandbox.js";
import { graphicRuntimeDirectory } from "./graphic-render.js";
import {
  previewResponseSchema,
  previewFrameSchema,
} from "./graphic-preview-protocol.js";

type Entry = {
  input: GraphicPreviewInput;
  signal?: AbortSignal;
  resolve: (result: Result<GraphicPreviewFrame>) => void;
};
type Pending = {
  resolve: (result: Result<unknown>) => void;
  timer: ReturnType<typeof setTimeout>;
};
export class GraphicPreviewHost {
  private child?: ChildProcessWithoutNullStreams;

  private directory = "";

  private unit?: string;

  private exited: Promise<unknown> = Promise.resolve();

  private stopping?: Promise<void>;

  private closed = false;

  private running = false;
  private draining: Promise<void> = Promise.resolve();
  private generation = 0;

  private nextId = 1;

  private queued = new Map<string, Entry>();

  private loaded = new Set<string>();

  private pending = new Map<number, Pending>();

  private failure?: { code: string; message: string };

  render(
    input: GraphicPreviewInput,
    signal?: AbortSignal,
  ): Promise<Result<GraphicPreviewFrame>> {
    if (this.closed)
      return Promise.resolve({
        ok: false,
        error: { code: "UNAVAILABLE", message: "Graphics preview is closed" },
      });
    return new Promise((resolve) => {
      const old = this.queued.get(input.key);
      old?.resolve({
        ok: false,
        error: {
          code: "CANCELLED",
          message: "A newer preview frame replaced this request",
        },
      });
      if (!old && this.queued.size >= 4) {
        resolve({
          ok: false,
          error: {
            code: "QUEUE_FULL",
            message: "Too many pending graphic previews",
          },
        });
        return;
      }
      this.queued.set(input.key, { input, signal, resolve });
      if (!this.running) this.draining = this.drain();
    });
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (this.queued.size && !this.closed) {
      const entry = this.queued.values().next().value;
      if (!entry) break;
      this.queued.delete(entry.input.key);
      const abort = () => {
        this.failure = {
          code: "CANCELLED",
          message: "Graphics preview cancelled",
        };
        void this.stop();
      };
      entry.signal?.addEventListener("abort", abort, { once: true });
      try {
        if (entry.signal?.aborted)
          entry.resolve({
            ok: false,
            error: { code: "CANCELLED", message: "Graphics preview cancelled" },
          });
        else entry.resolve(await this.renderNext(entry.input));
      } catch (failure) {
        entry.resolve({
          ok: false,
          error: {
            code: "IO_ERROR",
            message:
              failure instanceof Error ? failure.message : String(failure),
          },
        });
      } finally {
        entry.signal?.removeEventListener("abort", abort);
      }
    }
    this.running = false;
  }

  private async renderNext(
    input: GraphicPreviewInput,
  ): Promise<Result<GraphicPreviewFrame>> {
    const started = await this.start();
    if (!started.ok) return started;
    if (!this.loaded.has(input.key)) {
      const loaded = await this.send({ kind: "load", input }, 15000);
      if (!loaded.ok) return loaded;
      this.loaded.add(input.key);
      while (this.loaded.size > 4)
        this.loaded.delete(this.loaded.values().next().value ?? "");
    }
    const frame = await this.send(
      {
        kind: "frame",
        key: input.key,
        frame: input.frame,
        values: input.values,
        layerStates: input.layerStates,
      },
      7000,
    );
    if (!frame.ok) {
      await this.stop();
      return frame;
    }
    const parsed = previewFrameSchema.safeParse(frame.value);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : {
          ok: false,
          error: {
            code: "IO_ERROR",
            message: "Invalid preview image response",
          },
        };
  }

  private async start(): Promise<Result<void>> {
    const generation = this.generation;
    await this.stopping;
    const interrupted = () => this.closed || generation !== this.generation;
    const cancelled: Result<void> = {
      ok: false,
      error: { code: "CANCELLED", message: "Preview startup was interrupted" },
    };
    if (interrupted()) return cancelled;
    if (this.child) return { ok: true, value: undefined };
    if (process.platform !== "linux")
      return {
        ok: false,
        error: {
          code: "UNAVAILABLE",
          message:
            "Project preview requires the supported Linux execution boundary",
        },
      };
    const runtime = graphicRuntimeDirectory();
    this.directory = await mkdtemp(join(tmpdir(), "forgecut-graphic-preview-"));
    if (interrupted()) {
      await this.stop();
      return cancelled;
    }
    const invocation = await budgetedMediaCommand("bwrap", [
      ...graphicSandboxArgs(runtime, this.directory),
      "--",
      process.execPath,
      join(runtime, "preview-worker.cjs"),
    ]);
    if (interrupted()) {
      await this.stop();
      return cancelled;
    }
    if (!invocation.unit) {
      await this.stop();
      return {
        ok: false,
        error: {
          code: "UNAVAILABLE",
          message:
            "Project preview requires a Linux systemd user scope with CPU and memory limits",
        },
      };
    }
    this.unit = invocation.unit;
    this.failure = undefined;
    const child = spawn(invocation.command, invocation.args, {
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.child = child;
    this.exited = once(child, "close").catch(() => {});
    let output = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (Buffer.byteLength(output) > 4194304) {
        this.failure = {
          code: "TOO_LARGE",
          message: "Preview response exceeds 4 MiB",
        };
        void this.stop();
        return;
      }
      let end = output.indexOf("\n");
      while (end >= 0) {
        const line = output.slice(0, end);
        output = output.slice(end + 1);
        try {
          const value: unknown = JSON.parse(line);
          const response = previewResponseSchema.parse(value);
          const pending = this.pending.get(response.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(response.id);
            pending.resolve(
              response.ok
                ? { ok: true, value: response.value }
                : { ok: false, error: response.error },
            );
          }
        } catch {
          this.failure = {
            code: "IO_ERROR",
            message: "Invalid preview worker response",
          };
          void this.stop();
        }
        end = output.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-8192);
    });
    child.stdin.on("error", (error) => {
      stderr = error.message;
    });
    child.on("error", (error) => {
      this.failure = { code: "IO_ERROR", message: error.message };
    });
    child.on("close", () => {
      const error = this.failure ?? {
        code: "RENDER_FAILED",
        message: stderr || "Preview worker stopped",
      };
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.resolve({ ok: false, error });
      }
      this.pending.clear();
      if (this.child === child) {
        void this.stop();
      }
    });
    const ready = await this.wait(0, 15000);
    if (!ready.ok) {
      await this.stop();
      return ready;
    }
    return { ok: true, value: undefined };
  }

  private wait(id: number, timeout: number): Promise<Result<unknown>> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.failure = {
          code: "TIMEOUT",
          message: "Graphic preview exceeded its execution deadline",
        };
        void this.stop();
      }, timeout);
      this.pending.set(id, { resolve, timer });
    });
  }

  private async send(
    command: Record<string, unknown>,
    timeout: number,
  ): Promise<Result<unknown>> {
    if (!this.child)
      return {
        ok: false,
        error: {
          code: "UNAVAILABLE",
          message: "Preview worker is not running",
        },
      };
    const id = this.nextId;
    this.nextId += 1;
    const response = this.wait(id, timeout);
    this.child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    return response;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.generation += 1;
    for (const entry of this.queued.values())
      entry.resolve({
        ok: false,
        error: { code: "CANCELLED", message: "Graphics preview closed" },
      });
    this.queued.clear();
    await this.stop();
    await this.draining;
    await this.stop();
  }

  async reset(): Promise<void> {
    this.generation += 1;
    for (const entry of this.queued.values())
      entry.resolve({
        ok: false,
        error: { code: "CANCELLED", message: "Graphics preview reset" },
      });
    this.queued.clear();
    await this.stop();
    await this.draining;
    await this.stop();
  }

  private stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const { child } = this;
    const { directory } = this;
    const { unit } = this;
    this.child = undefined;
    this.directory = "";
    this.unit = undefined;
    this.loaded.clear();
    this.stopping = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const kill = () => {
        if (child?.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {}
        }
        if (unit)
          execFile(
            "systemctl",
            ["--user", "kill", "--kill-whom=all", "--signal=SIGKILL", unit],
            { timeout: 2000 },
            () => {},
          );
      };
      if (child) {
        child.kill("SIGTERM");
        timer = setTimeout(kill, 3000);
        await this.exited;
        if (timer) clearTimeout(timer);
        kill();
      }
      if (directory)
        try {
          await rm(directory, { recursive: true, force: true });
        } catch (failure) {
          this.failure = {
            code: "IO_ERROR",
            message: `Preview cleanup failed: ${failure instanceof Error ? failure.message : String(failure)}`,
          };
        }
    })().finally(() => {
      this.stopping = undefined;
    });
    return this.stopping;
  }
}
