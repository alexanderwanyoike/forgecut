/** @vitest-environment node */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

it.skipIf(spawnSync("ffprobe", ["-version"]).status !== 0)(
  "rejects a pending relink when a newer edit changes the project",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "forgecut-relink-"));
    try {
      const path = join(dir, "replacement.png");
      await writeFile(
        path,
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
          "base64",
        ),
      );
      const state = new AppState();
      state.executeProjectChange((project) => {
        project.assets.push({
          id: "image",
          name: "Original",
          path: "/original.png",
          kind: "Image",
          probe: null,
        });
      });
      const service = new EditingService(state);
      const pending = service.execute("relink_asset", { id: "image", path });
      state.executeProjectChange((project) => {
        project.assets[0].path = "/newer-choice.png";
      });
      const newer = state.snapshot();
      expect(await pending).toMatchObject({
        ok: false,
        error: { code: "CONFLICT" },
      });
      expect(state.snapshot()).toEqual(newer);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
