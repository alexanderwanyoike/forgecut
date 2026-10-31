import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Result } from "../shared/result.js";
import { extractStoryboardArchive } from "./storyboard-archive.js";
import { storyboardManifestSchema } from "./storyboard-manifest.js";

export async function prepareStoryboardMedia(source: string, signal?: AbortSignal): Promise<Result<{
  directory: string;
  files: { path: string; name: string }[];
}>> {
  let directory: string | undefined;
  try {
    const root = process.env.FORGECUT_STORYBOARD_DIR ?? join(homedir(), ".forgecut", "storyboards");
    await mkdir(root, { recursive: true });
    directory = await mkdtemp(join(root, "storyboard-"));
    const entries = await extractStoryboardArchive(source, directory, signal);
    const manifest = storyboardManifestSchema.safeParse(JSON.parse(await readFile(join(directory, "storyboard.json"), "utf8")) as unknown);
    if (!manifest.success) throw new Error("Unsupported or invalid Showbiz storyboard manifest");
    const files: { path: string; name: string }[] = [];
    const referenced = new Set<string>();
    for (const shot of manifest.data.shots.toSorted((a, b) => a.order - b.order)) {
      for (const media of shot.media) {
        if (!entries.has(media.path) || referenced.has(media.path)) throw new Error("Storyboard media is missing or duplicated");
        referenced.add(media.path);
        files.push({ path: join(directory, media.path), name: `${manifest.data.storyboard.name} - Shot ${shot.order} - ${media.role}` });
      }
    }
    if (files.length === 0 || entries.size !== referenced.size + 1) throw new Error("Storyboard package has missing or unreferenced media");
    return { ok: true, value: { directory, files } };
  } catch (cause) {
    if (directory) await rm(directory, { recursive: true, force: true });
    return { ok: false, error: { code: signal?.aborted ? "CANCELLED" : "INVALID_INPUT", message: cause instanceof Error ? cause.message : String(cause) } };
  }
}
