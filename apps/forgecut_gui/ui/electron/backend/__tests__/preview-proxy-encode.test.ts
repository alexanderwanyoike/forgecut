/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  encodePreviewProxy,
  needsPreviewProxy,
  probeKeyframes,
  PROBE_SECONDS,
} from "../preview-proxy";

const available = spawnSync("ffmpeg", ["-version"]).status === 0;

it.skipIf(!available)(
  "turns a sparse-keyframe recording into a 720p proxy with quarter-second keyframes",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-proxy-encode-"));
    try {
      const source = join(directory, "recording.mkv");
      const made = spawnSync("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=1920x1080:rate=30:duration=3",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=3",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-g",
        "60",
        "-c:a",
        "aac",
        source,
      ]);
      expect(made.status, made.stderr.toString()).toBe(0);
      const keyframes = await probeKeyframes(source);
      if (!keyframes.ok) throw new Error(keyframes.error.message);
      expect(needsPreviewProxy(keyframes.value, PROBE_SECONDS)).toBe(true);
      const output = join(directory, "proxy.mp4");
      expect(await encodePreviewProxy(source, output)).toEqual({
        ok: true,
        value: null,
      });
      const streams = spawnSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "stream=codec_type,codec_name,width,height",
          "-of",
          "json",
          output,
        ],
        { encoding: "utf8" },
      );
      expect(JSON.parse(streams.stdout).streams).toEqual([
        expect.objectContaining({
          codec_type: "video",
          codec_name: "h264",
          width: 1280,
          height: 720,
        }),
        expect.objectContaining({ codec_type: "audio", codec_name: "aac" }),
      ]);
      const proxied = await probeKeyframes(output);
      if (!proxied.ok) throw new Error(proxied.error.message);
      expect(needsPreviewProxy(proxied.value, PROBE_SECONDS)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  60000,
);
