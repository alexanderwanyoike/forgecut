import { mkdir, mkdtemp } from "node:fs/promises";
import { dirname, join } from "node:path";

export function batchStagePath(directory: string, entryId: string): string {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(entryId))
    throw new Error("Batch staging requires a valid entry identity");
  return join(directory, `.forgecut-export-${entryId}`);
}

export async function createExportStage(
  outputPath: string,
  entryId?: string,
): Promise<string> {
  if (!entryId) return mkdtemp(join(dirname(outputPath), ".forgecut-export-"));
  const directory = batchStagePath(dirname(outputPath), entryId);
  await mkdir(directory, { mode: 0o700 });
  return directory;
}
