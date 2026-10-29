/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  symlink,
  rm,
  writeFile,
  readFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { runGraphicWorker } from "../graphic-worker-process";

const available =
  process.platform === "linux" &&
  spawnSync("bwrap", ["--version"]).status === 0;
for (const mode of ["cancel", "crash"] as const) {
  it.skipIf(!available)(
    `terminates detached descendants after worker ${mode} without a systemd scope`,
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "forgecut-worker-tree-"));
      const marker = `forgecut-detached-${randomUUID()}`;
      const controller = new AbortController();
      const previous = process.env.PATH;
      const runningChildren = () =>
        spawnSync("/usr/bin/pgrep", ["-f", marker], {
          encoding: "utf8",
        }).stdout.trim();
      let running: ReturnType<typeof runGraphicWorker> | undefined;
      try {
        await writeFile(
          join(directory, "worker.cjs"),
          `const {spawn}=require('node:child_process');
        process.on('SIGTERM',()=>{});
        spawn(process.execPath,['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)', ${JSON.stringify(marker)}], {detached:true,stdio:'ignore'});
        ${mode === "crash" ? "setTimeout(()=>process.exit(1),500);" : "setInterval(()=>{},1000);"}`,
        );
        const jobPath = join(directory, "job.json");
        await writeFile(jobPath, "{}");
        const tools = join(directory, "tools");
        await mkdir(tools);
        await symlink("/usr/bin/bwrap", join(tools, "bwrap"));
        process.env.PATH = tools;
        running = runGraphicWorker(directory, jobPath, controller.signal);
        for (let attempt = 0; attempt < 200 && !runningChildren(); attempt += 1)
          await new Promise((resolve) => setTimeout(resolve, 10));
        expect(runningChildren()).not.toBe("");
        if (mode === "cancel") controller.abort();
        expect(await running).toMatchObject({
          ok: false,
          error: { code: mode === "cancel" ? "CANCELLED" : "RENDER_FAILED" },
        });
        expect(runningChildren()).toBe("");
      } finally {
        process.env.PATH = previous;
        controller.abort();
        await running;
        for (const pid of runningChildren().split(/\s+/).filter(Boolean)) {
          try {
            if (
              (await readFile(`/proc/${pid}/cmdline`, "utf8")).includes(marker)
            )
              process.kill(Number(pid), "SIGKILL");
          } catch {}
        }
        await rm(directory, { recursive: true, force: true });
      }
    },
    15000,
  );
}
