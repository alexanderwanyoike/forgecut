/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { runMediaProcess } from "../media-process";

it.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)(
  "cancels a real media process and returns a typed outcome",
  async () => {
    const controller = new AbortController();
    const running = runMediaProcess(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-threads",
        "1",
        "-filter_threads",
        "1",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=16x16:rate=1",
        "-f",
        "null",
        "-",
      ],
      { signal: controller.signal },
    );
    controller.abort();
    expect(await running).toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
  },
);
