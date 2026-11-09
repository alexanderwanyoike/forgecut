/** @vitest-environment node */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { exportProject } from "../exporter";
import type { Project } from "../state";

const media = vi.hoisted(() => ({
  run: vi.fn(
    async (
      _executable: string,
      args: string[],
      _options: { cpuPercent?: number },
    ) => {
      await writeFile(args.at(-1)!, "");
      return { ok: true, value: Buffer.alloc(0) };
    },
  ),
}));
vi.mock("../media-process", () => ({ runMediaProcess: media.run }));

it("lets each export process use as many threads as the media slice quota allows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-export-threads-"));
  try {
    const project: Project = {
      id: "project",
      name: "Threads",
      settings: { width: 64, height: 36, fps: 10, sample_rate: 48000 },
      assets: [
        {
          id: "asset",
          name: "clip.mp4",
          path: join(directory, "clip.mp4"),
          kind: "Video",
          probe: null,
        },
      ],
      timeline: {
        markers: [],
        tracks: [
          {
            id: "video",
            kind: "Video",
            items: [
              {
                VideoClip: {
                  id: "clip",
                  asset_id: "asset",
                  track_id: "video",
                  timeline_start_us: 0,
                  source_in_us: 0,
                  source_out_us: 1_000_000,
                },
              },
            ],
          },
        ],
      },
    };
    // Only the spawned processes matter here, not publishing the stub output.
    await exportProject(project, join(directory, "out.mp4"));
    expect(media.run).toHaveBeenCalledTimes(2);
    for (const [, args, options] of media.run.mock.calls) {
      expect(options.cpuPercent).toBe(400);
      expect(args.slice(0, 7)).toEqual([
        "-y",
        "-hide_banner",
        "-threads",
        "4",
        "-filter_complex_threads",
        "4",
        "-threads",
      ]);
      expect(args.join(" ")).not.toContain("-threads 1");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
