/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

const available = spawnSync("ffmpeg", ["-version"]).status === 0;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function clip(path: string, keyframeFrames: number) {
  const made = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=64x36:rate=30:duration=3",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-g",
    String(keyframeFrames),
    path,
  ]);
  if (made.status !== 0) throw new Error(made.stderr.toString());
}

it.skipIf(!available)(
  "prepares a proxy only for video sources that seek slowly",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-proxy-command-"));
    vi.stubEnv("XDG_CACHE_HOME", join(directory, "cache"));
    const state = new AppState();
    const service = new EditingService(state);
    cleanups.push(async () => {
      await service.closePreviews();
      await rm(directory, { recursive: true, force: true });
    });
    const sparse = join(directory, "recording.mkv");
    const dense = join(directory, "phone.mp4");
    clip(sparse, 60);
    clip(dense, 5);
    const imported = await service.execute("import_assets", {
      paths: [sparse, dense],
    });
    if (!imported.ok) throw new Error(imported.error.message);
    const [recording, phone] = state.project.assets;
    const proxied = await service.execute("get_preview_proxy", {
      assetId: recording.id,
    });
    if (!proxied.ok) throw new Error(proxied.error.message);
    const { path } = proxied.value as { path: string | null };
    expect(path?.startsWith(join(directory, "cache"))).toBe(true);
    expect(existsSync(path!)).toBe(true);
    expect(service.proxies.owns(path!)).toBe(true);
    expect(
      await service.execute("get_preview_proxy", { assetId: phone.id }),
    ).toMatchObject({ ok: true, value: { path: null } });
    expect(
      await service.execute("get_preview_proxy", {
        assetId: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  },
  60000,
);
