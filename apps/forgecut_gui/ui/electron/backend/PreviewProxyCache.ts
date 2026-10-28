import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { Result } from "../shared/result.js";
import {
  encodePreviewProxy,
  needsPreviewProxy,
  probeKeyframes,
  PROBE_SECONDS,
} from "./preview-proxy.js";

type Options = {
  root?: string;
  capBytes?: number;
  probe?: (source: string, signal?: AbortSignal) => Promise<Result<number[]>>;
  encode?: (
    source: string,
    output: string,
    signal?: AbortSignal,
  ) => Promise<Result<null>>;
};

/** Changing the encode settings must not serve proxies made with the old ones. */
const PROFILE = "720p-keyframe-quarter-second-v1";

// Uses within one millisecond must still order for least-recently-used eviction.
let lastUse = 0;
function useTime(): Date {
  lastUse = Math.max(Date.now(), lastUse + 1);
  return new Date(lastUse);
}

/**
 * Seek-friendly copies of slow-seeking sources, used only by preview.
 * See ADR 0004, "Preview proxies".
 */
export class PreviewProxyCache {
  private readonly root: string;

  private readonly capBytes: number;

  private readonly probe: NonNullable<Options["probe"]>;

  private readonly encode: NonNullable<Options["encode"]>;

  private readonly preparing = new Map<
    string,
    Promise<Result<string | undefined>>
  >();

  private readonly owned = new Set<string>();

  private queue: Promise<unknown> = Promise.resolve();

  private readonly controller = new AbortController();

  private closed = false;

  constructor(options: Options = {}) {
    this.root =
      options.root ??
      join(
        process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
        "forgecut",
        "preview-proxies",
      );
    this.capBytes = options.capBytes ?? 20 * 1024 ** 3;
    this.probe = options.probe ?? probeKeyframes;
    this.encode = options.encode ?? encodePreviewProxy;
  }

  /** The proxy to play instead of `source`, or none when it seeks well already. */
  async prepare(source: string): Promise<Result<string | undefined>> {
    if (this.closed)
      return {
        ok: false,
        error: { code: "UNAVAILABLE", message: "Preview proxies are closed" },
      };
    const key = await sourceKey(source);
    const existing = this.preparing.get(key);
    if (existing)
      return existing.then(async (result) => {
        if (result.ok && result.value)
          await utimes(result.value, useTime(), useTime());
        return result;
      });
    const task = this.produce(source, key);
    this.preparing.set(key, task);
    void task.then((result) => {
      if (!result.ok) this.preparing.delete(key);
    });
    return task;
  }

  owns(path: string): boolean {
    return this.owned.has(path);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.controller.abort();
    await this.queue;
  }

  private async produce(
    source: string,
    key: string,
  ): Promise<Result<string | undefined>> {
    const { signal } = this.controller;
    const path = join(this.root, `${key}.mp4`);
    try {
      await stat(path);
      await utimes(path, useTime(), useTime());
      this.owned.add(path);
      return { ok: true, value: path };
    } catch {}
    const keyframes = await this.probe(source, signal);
    if (!keyframes.ok) return keyframes;
    if (!needsPreviewProxy(keyframes.value, PROBE_SECONDS))
      return { ok: true, value: undefined };
    const run = () => this.encodeOnce(source, path, signal);
    const task = this.queue.then(run, run);
    this.queue = task;
    return task;
  }

  private async encodeOnce(
    source: string,
    path: string,
    signal: AbortSignal,
  ): Promise<Result<string | undefined>> {
    const cancelled = {
      ok: false as const,
      error: { code: "CANCELLED", message: "Preview proxies are closed" },
    };
    if (signal.aborted) return cancelled;
    await mkdir(this.root, { recursive: true });
    const partial = `${path}.partial`;
    try {
      const encoded = await this.encode(source, partial, signal);
      if (!encoded.ok) return encoded;
      if (signal.aborted) return cancelled;
      await rename(partial, path);
      await utimes(path, useTime(), useTime());
      this.owned.add(path);
      await this.evict(path);
      return { ok: true, value: path };
    } catch (failure) {
      return {
        ok: false,
        error: {
          code: "IO_ERROR",
          message: failure instanceof Error ? failure.message : String(failure),
        },
      };
    } finally {
      await rm(partial, { force: true });
    }
  }

  private async evict(keep: string): Promise<void> {
    const files = await Promise.all(
      (await readdir(this.root))
        .filter((name) => name.endsWith(".mp4"))
        .map(async (name) => {
          const path = join(this.root, name);
          const info = await stat(path);
          return { path, size: info.size, used: info.mtimeMs };
        }),
    );
    files.sort((a, b) => b.used - a.used);
    let total = 0;
    for (const file of files) {
      total += file.size;
      if (total <= this.capBytes || file.path === keep) continue;
      await rm(file.path, { force: true });
      this.owned.delete(file.path);
      this.preparing.delete(basename(file.path, ".mp4"));
    }
  }
}

async function sourceKey(source: string): Promise<string> {
  const info = await stat(source);
  return createHash("sha256")
    .update(JSON.stringify([PROFILE, source, info.size, info.mtimeMs]))
    .digest("hex");
}
