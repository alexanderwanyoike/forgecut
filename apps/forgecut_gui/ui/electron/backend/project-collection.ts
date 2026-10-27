import { constants, createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Project } from "../shared/ipc-contract.js";
import type {
  ProjectCollection,
  ProjectCollectionRequest,
} from "../shared/project-collection.js";
import type { Result } from "../shared/result.js";
import type { JobSnapshot, JobRequest } from "../shared/jobs.js";
import { AppState } from "./state.js";
import type { JobQueue } from "./job-queue.js";

export function startProjectCollection(
  state: AppState,
  jobs: JobQueue,
  request: ProjectCollectionRequest,
): Result<JobSnapshot> {
  if (state.sessionId !== request.sessionId)
    return {
      ok: false,
      error: {
        code: "PROJECT_CHANGED",
        message: "The project session changed",
      },
    };
  const job: JobRequest = {
    sessionId: request.sessionId,
    projectRevision: request.expectedRevision,
    requestId: request.requestId,
    kind: "collect",
    label: "Collect project",
    input: request,
  };
  const replay = jobs.replay(job);
  if (!replay.ok) return replay;
  if (replay.value) return { ok: true, value: replay.value };
  if (state.revision !== request.expectedRevision)
    return {
      ok: false,
      error: {
        code: "CONFLICT",
        message: "Read the current project revision before collecting",
      },
    };
  const ids = new Set(request.assetIds);
  if (
    ids.size !== request.assetIds.length ||
    request.assetIds.some(
      (id) => !state.project.assets.some((asset) => asset.id === id),
    )
  )
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Choose distinct assets from the current project",
      },
    };
  const project = state.project;
  const directory = resolve(request.directory);
  return jobs.start(job, (signal, report, beginCommit) =>
    collectProject(project, directory, ids, signal, report, beginCommit),
  );
}

async function collectProject(
  project: Project,
  directory: string,
  ids: ReadonlySet<string>,
  signal: AbortSignal,
  report: (progress: number) => void,
  beginCommit: () => boolean,
): Promise<Result<ProjectCollection>> {
  let owned = false;
  try {
    signal.throwIfAborted();
    await mkdir(directory, { mode: 0o700 });
    owned = true;
    const captured = structuredClone(project);
    const selected = captured.assets.filter((asset) => ids.has(asset.id));
    if (selected.length) await mkdir(join(directory, "media"), { mode: 0o700 });
    let completed = 0;
    for (const asset of selected) {
      signal.throwIfAborted();
      const source = await open(
        asset.path,
        process.platform === "win32" ? "r" : constants.O_NONBLOCK,
      );
      try {
        const metadata = await source.stat();
        if (!metadata.isFile())
          throw new Error("Collected media must be regular files");
        const extension = extname(asset.path);
        const filename = `${randomUUID()}${/^\.[a-z0-9]{1,10}$/i.test(extension) ? extension : ""}`;
        const destination = join(directory, "media", filename);
        const readable = source.createReadStream({
          autoClose: false,
          highWaterMark: 65536,
        });
        let copied = 0;
        readable.on("data", (chunk: Buffer) => {
          copied += chunk.length;
          report(
            (0.9 *
              (completed + Math.min(1, copied / Math.max(1, metadata.size)))) /
              selected.length,
          );
        });
        await pipeline(
          readable,
          createWriteStream(destination, {
            flags: "wx",
            mode: 0o600,
            highWaterMark: 65536,
          }),
          { signal },
        );
        if (copied !== metadata.size)
          throw new Error("Source media changed size while collecting");
        asset.path = destination;
        completed += 1;
      } finally {
        await source.close();
      }
    }
    signal.throwIfAborted();
    if (!beginCommit())
      throw new Error("Collection cancelled before publication");
    const copy = new AppState();
    copy.replaceProject(captured);
    const projectPath = join(directory, "project.forgecut");
    await copy.saveProject(projectPath);
    return {
      ok: true,
      value: {
        projectPath,
        copiedAssets: selected.length,
        externalAssets: captured.assets.length - selected.length,
      },
    };
  } catch (cause) {
    if (owned)
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      }).catch(() => {});
    const code = signal.aborted
      ? "CANCELLED"
      : (cause as NodeJS.ErrnoException)?.code === "EEXIST"
        ? "CONFLICT"
        : "IO_ERROR";
    return {
      ok: false,
      error: {
        code,
        message: cause instanceof Error ? cause.message : String(cause),
      },
    };
  }
}
