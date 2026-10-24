/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { runMediaProcess } from "../media-process";

const available =
  process.platform === "linux" &&
  spawnSync("systemctl", ["--user", "is-active", "--quiet", "default.target"])
    .status === 0 &&
  spawnSync("ffmpeg", ["-version"]).status === 0;

it.skipIf(!available)(
  "applies the proven process memory and CPU budget to real media work",
  async () => {
    const controller = new AbortController();
    let resolveLimits!: (value: {
      group: string;
      memory: string;
      high: string;
      swap: string;
      cpu: string;
      parent: string;
      parentMemory: string;
      parentCpu: string;
    }) => void;
    let rejectLimits!: (error: unknown) => void;
    const observed = new Promise<{
      group: string;
      memory: string;
      high: string;
      swap: string;
      cpu: string;
      parent: string;
      parentMemory: string;
      parentCpu: string;
    }>((resolve, reject) => {
      resolveLimits = resolve;
      rejectLimits = reject;
    });
    let inspected = false;
    const running = runMediaProcess(
      "ffmpeg",
      [
        "-hide_banner",
        "-re",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=18x18:r=10",
        "-threads",
        "1",
        "-filter_threads",
        "1",
        "-f",
        "null",
        "-",
      ],
      {
        signal: controller.signal,
        budget: true,
        onStderr: () => {
          if (inspected) return;
          inspected = true;
          void (async () => {
            const pids = spawnSync(
              "pgrep",
              ["--parent", String(process.pid), "-x", "ffmpeg"],
              { encoding: "utf8" },
            )
              .stdout.trim()
              .split(/\s+/);
            for (const pid of pids) {
              if (
                !(await readFile(`/proc/${pid}/cmdline`, "utf8")).includes(
                  "color=c=black:s=18x18:r=10",
                )
              )
                continue;
              const group = (await readFile(`/proc/${pid}/cgroup`, "utf8"))
                .trim()
                .split(":")
                .at(-1)!;
              if (!group.includes("forgecut-media-"))
                throw new Error(
                  "Media process is outside its required resource scope.",
                );
              const root = `/sys/fs/cgroup${group}`;
              return {
                group,
                parent: dirname(group),
                parentMemory: (
                  await readFile(`${dirname(root)}/memory.max`, "utf8")
                ).trim(),
                parentCpu: (
                  await readFile(`${dirname(root)}/cpu.max`, "utf8")
                ).trim(),
                memory: (await readFile(`${root}/memory.max`, "utf8")).trim(),
                high: (await readFile(`${root}/memory.high`, "utf8")).trim(),
                swap: (
                  await readFile(`${root}/memory.swap.max`, "utf8")
                ).trim(),
                cpu: (await readFile(`${root}/cpu.max`, "utf8")).trim(),
              };
            }
            throw new Error("The media process was not observable.");
          })().then(resolveLimits, rejectLimits);
        },
      },
    );
    try {
      const limits = await observed;
      expect(limits).toMatchObject({
        parentMemory: "3221225472",
        parentCpu: "150000 100000",
        parent: expect.stringContaining("forgecut-media.slice"),
        memory: "3221225472",
        high: "2147483648",
        swap: "268435456",
        cpu: "150000 100000",
      });
      expect(limits.group).toContain("forgecut-media-");
    } finally {
      controller.abort();
      await running;
    }
  },
);
