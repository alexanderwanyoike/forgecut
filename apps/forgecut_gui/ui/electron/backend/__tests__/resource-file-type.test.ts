/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

const available =
  process.platform !== "win32" &&
  spawnSync("mkfifo", ["--version"]).status === 0;
afterEach(() => vi.unstubAllEnvs());
for (const source of ["resource", "license"] as const) {
  it.skipIf(!available)(
    `rejects a ${source} FIFO without waiting for a writer`,
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "forgecut-resource-filetype-"),
      );
      try {
        vi.stubEnv("FORGECUT_RESOURCE_DIR", join(directory, "cache"));
        const pipe = join(directory, "blocked.pipe");
        const created = spawnSync("mkfifo", [pipe]);
        if (created.status !== 0) throw new Error(created.stderr.toString());
        const font = join(directory, "font.ttf");
        await writeFile(
          font,
          Buffer.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        );
        const state = new AppState();
        const before = state.snapshot();
        const pending = new EditingService(state).execute(
          "import_graphic_resource",
          source === "resource"
            ? {
                path: pipe,
                kind: "Font",
                license: { identifier: "test-only", text: "Fixture" },
              }
            : { path: font, kind: "Font", licensePath: pipe },
        );
        const early = await Promise.race([
          pending,
          new Promise<"blocked">((resolve) =>
            setTimeout(() => resolve("blocked"), 200),
          ),
        ]);
        if (early === "blocked") {
          const writer = await open(pipe, "w");
          await writer.close();
          await pending;
        }
        expect(early).toMatchObject({
          ok: false,
          error: {
            code: "INVALID_INPUT",
            message: expect.stringMatching(/regular file/i),
          },
        });
        expect(state.snapshot()).toEqual(before);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
