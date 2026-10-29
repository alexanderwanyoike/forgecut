/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { runGraphicWorker } from "../graphic-worker-process";

it.skipIf(
  process.platform !== "linux" ||
    spawnSync("bwrap", ["--version"]).status !== 0,
)(
  "grants only runtime and job files while denying host secrets environment and network",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-isolation-"));
    const runtime = join(directory, "runtime");
    const work = join(directory, "job");
    await mkdir(runtime);
    await mkdir(work);
    const sentinel = join(directory, "host-secret.txt");
    await writeFile(sentinel, "private host data");
    const server = createServer((_request, response) =>
      response.end("private host service"),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing host service");
    vi.stubEnv("FORGECUT_HOST_SECRET", "private environment");
    try {
      await writeFile(
        join(runtime, "worker.cjs"),
        `const fs=require('node:fs');
    (async()=>{
      let file=false;try{fs.readFileSync(${JSON.stringify(sentinel)});file=true;}catch{}
      let network=false;try{network=(await fetch(${JSON.stringify(`http://127.0.0.1:${address.port}/`)},{signal:AbortSignal.timeout(1000)})).ok;}catch{}
      let runtimeWrite=false;try{fs.writeFileSync(__filename,'modified');runtimeWrite=true;}catch{}
      const result={file,network,runtimeWrite,environment:process.env.FORGECUT_HOST_SECRET!==undefined};
      fs.writeFileSync(${JSON.stringify(join(work, "probe.json"))},JSON.stringify(result));
      if(Object.values(result).some(Boolean))process.exitCode=1;
    })().catch(error=>{console.error(error);process.exitCode=1;});`,
      );
      const job = join(work, "job.json");
      await writeFile(job, "{}");
      expect(await runGraphicWorker(runtime, job)).toMatchObject({ ok: true });
      expect(
        JSON.parse(await readFile(join(work, "probe.json"), "utf8")),
      ).toEqual({
        file: false,
        network: false,
        runtimeWrite: false,
        environment: false,
      });
      expect(await readFile(sentinel, "utf8")).toBe("private host data");
    } finally {
      vi.unstubAllEnvs();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
  15000,
);

it.skipIf(
  process.platform !== "linux" ||
    spawnSync("bwrap", ["--version"]).status !== 0,
)(
  "refuses project code when a CPU and memory scope is unavailable",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-budget-"));
    const tools = join(directory, "tools");
    await mkdir(tools);
    const { symlink } = await import("node:fs/promises");
    await symlink("/usr/bin/bwrap", join(tools, "bwrap"));
    const marker = join(directory, "executed");
    await writeFile(
      join(directory, "worker.cjs"),
      `require('node:fs').writeFileSync(${JSON.stringify(marker)},'executed')`,
    );
    const job = join(directory, "job.json");
    await writeFile(job, "{}");
    vi.stubEnv("PATH", tools);
    try {
      expect(
        await runGraphicWorker(directory, job, undefined, true),
      ).toMatchObject({
        ok: false,
        error: {
          code: "UNAVAILABLE",
          message: expect.stringContaining("CPU and memory"),
        },
      });
      await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
