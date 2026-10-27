import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { check } from "proper-lockfile";
import { EXPORT_PRESETS } from "../shared/export-presets.js";
import type {
  CreateExportBatch,
  ExportBatchResult,
  ExportBatchSnapshot,
} from "../shared/export-batches.js";
import { projectSequences } from "../domain/project-sequences.js";
import { AppState } from "./state.js";
import { atomicWrite } from "./atomic-file.js";
import {
  exportBatchSchema,
  type ExportBatchRecord,
} from "./export-batch-schema.js";

const MAX_BATCH_BYTES = 8 * 1024 * 1024;
export const batchHash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export async function readBatchFile(path: string): Promise<Buffer> {
  const file = await open(
    path,
    process.platform === "win32" ? "r" : constants.O_NONBLOCK,
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_BATCH_BYTES)
      throw new Error("Batch files must be regular files no larger than 8 MiB");
    const bytes = Buffer.alloc(stat.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const next = await file.read(bytes, count, bytes.length - count, count);
      if (!next.bytesRead) break;
      count += next.bytesRead;
    }
    if (count > stat.size) throw new Error("Batch file changed while reading");
    return bytes.subarray(0, count);
  } finally {
    await file.close();
  }
}

export function batchSnapshot(
  record: ExportBatchRecord,
  directory: string,
  active: boolean,
): ExportBatchSnapshot {
  return {
    id: record.id,
    directory,
    projectName: record.projectName,
    projectRevision: record.projectRevision,
    active,
    progress:
      record.entries.filter((entry) => entry.status === "completed").length /
      record.entries.length,
    entries: record.entries.map((entry) => ({
      ...entry,
      status:
        entry.status === "running" && !active ? "interrupted" : entry.status,
    })),
  };
}
export function batchFailure(cause: unknown): ExportBatchResult<never> {
  const code =
    cause instanceof z.ZodError || cause instanceof SyntaxError
      ? "INVALID_INPUT"
      : (cause as NodeJS.ErrnoException)?.code === "EEXIST" ||
          (cause as NodeJS.ErrnoException)?.code === "ELOCKED"
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
export async function readBatchRecord(
  directory: string,
): Promise<ExportBatchRecord> {
  return exportBatchSchema.parse(
    JSON.parse(
      (await readBatchFile(join(directory, "batch.json"))).toString("utf8"),
    ),
  );
}
export function writeBatchRecord(
  directory: string,
  record: ExportBatchRecord,
): Promise<void> {
  return atomicWrite(
    join(directory, "batch.json"),
    `${JSON.stringify(record, null, 2)}\n`,
  );
}
export async function readExportBatch(
  directory: string,
): Promise<ExportBatchResult> {
  try {
    const path = await realpath(directory);
    return {
      ok: true,
      value: batchSnapshot(
        await readBatchRecord(path),
        path,
        await check(path),
      ),
    };
  } catch (cause) {
    return batchFailure(cause);
  }
}
export async function createExportBatch(
  state: AppState,
  request: CreateExportBatch,
): Promise<ExportBatchResult> {
  if (state.sessionId !== request.sessionId)
    return {
      ok: false,
      error: {
        code: "PROJECT_CHANGED",
        message: "The project session changed",
      },
    };
  if (state.revision !== request.expectedRevision)
    return {
      ok: false,
      error: {
        code: "CONFLICT",
        message: "Read the current project revision before creating a batch",
      },
    };
  const project = state.project;
  const directory = resolve(request.directory);
  const preset = request.preset ?? "mp4";
  const sequences = projectSequences(project);
  const selected = request.sequenceIds.map((id) =>
    sequences.find((sequence) => sequence.id === id),
  );
  if (selected.some((sequence) => !sequence))
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "A selected sequence no longer exists",
      },
    };
  if (Buffer.byteLength(JSON.stringify(project)) > MAX_BATCH_BYTES - 1)
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "The captured batch project exceeds 8 MiB",
      },
    };
  let owned = false;
  try {
    await mkdir(directory, { mode: 0o700 });
    owned = true;
    await new AppState({}, project).saveProject(
      join(directory, "project.forgecut"),
    );
    const record: ExportBatchRecord = {
      version: 1,
      id: randomUUID(),
      projectName: project.name,
      projectRevision: request.expectedRevision,
      projectHash: batchHash(
        await readBatchFile(join(directory, "project.forgecut")),
      ),
      entries: selected.map((sequence) => {
        if (!sequence) throw new Error("Missing selected sequence");
        const id = randomUUID();
        const name =
          sequence.name.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 60) ||
          "sequence";
        return {
          id,
          sequenceId: sequence.id,
          name: sequence.name,
          preset,
          outputFile: `${name}-${id.slice(0, 8)}.${EXPORT_PRESETS[preset].extension}`,
          status: "pending",
        };
      }),
    };
    await writeBatchRecord(directory, record);
    return { ok: true, value: batchSnapshot(record, directory, false) };
  } catch (cause) {
    if (owned)
      await rm(directory, { recursive: true, force: true }).catch(() => {});
    return batchFailure(cause);
  }
}
