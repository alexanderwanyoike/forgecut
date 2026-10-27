import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { Project } from "../shared/ipc-contract.js";
import type {
  ProjectCollection,
  ProjectCollectionRequest,
} from "../shared/project-collection.js";
import type { Result } from "../shared/result.js";
import type { JobSnapshot, JobRequest } from "../shared/jobs.js";
import { copyCollectionMedia } from "./collection-media-copy.js";
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
  const { project } = state;
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
  let published = false;
  try {
    signal.throwIfAborted();
    await mkdir(directory, { mode: 0o700 });
    owned = true;
    const captured = structuredClone(project);
    const selected = captured.assets.filter((asset) => ids.has(asset.id));
    if (selected.length) await mkdir(join(directory, "media"), { mode: 0o700 });
    for (const [index, asset] of selected.entries()) {
      signal.throwIfAborted();
      const extension = extname(asset.path);
      const filename = `${randomUUID()}${/^\.[a-z0-9]{1,10}$/i.test(extension) ? extension : ""}`;
      const destination = join(directory, "media", filename);
      const copied = await copyCollectionMedia(
        asset.path,
        destination,
        signal,
        (progress) => report((0.9 * (index + progress)) / selected.length),
      );
      if (!copied.ok) return copied;
      asset.path = destination;
    }
    signal.throwIfAborted();
    if (!beginCommit())
      return {
        ok: false,
        error: {
          code: "CANCELLED",
          message: "Collection cancelled before publication",
        },
      };
    const copy = new AppState();
    copy.replaceProject(captured);
    const projectPath = join(directory, "project.forgecut");
    await copy.saveProject(projectPath);
    published = true;
    return {
      ok: true,
      value: {
        projectPath,
        copiedAssets: selected.length,
        externalAssets: captured.assets.length - selected.length,
      },
    };
  } catch (cause) {
    let code = "IO_ERROR";
    if (signal.aborted) code = "CANCELLED";
    else if ((cause as NodeJS.ErrnoException)?.code === "EEXIST")
      code = "CONFLICT";
    return {
      ok: false,
      error: {
        code,
        message: cause instanceof Error ? cause.message : String(cause),
      },
    };
  } finally {
    if (owned && !published)
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      }).catch(() => {});
  }
}
