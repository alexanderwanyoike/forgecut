/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { sourceFrame } from "../source-frame";

it.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)(
  "extracts a bounded JPEG frame from imported media",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "forgecut-frame-"));
    try {
      const path = join(dir, "image.png");
      await writeFile(
        path,
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
          "base64",
        ),
      );
      const result = await sourceFrame(
        { id: "source", path, name: "Image", kind: "Image", probe: null },
        0,
        new AbortController().signal,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.mimeType).toBe("image/jpeg");
      const bytes = Buffer.from(result.value.data, "base64");
      expect(bytes.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
      expect(bytes.length).toBeLessThanOrEqual(512 * 1024);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
