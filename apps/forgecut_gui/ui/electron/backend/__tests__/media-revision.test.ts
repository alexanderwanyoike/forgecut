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

it.skipIf(spawnSync("ffprobe", ["-version"]).status !== 0)(
  "rejects a pending import when a newer edit changes the project",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "forgecut-import-"));
    try {
      const path = join(dir, "image.png");
      await writeFile(
        path,
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
          "base64",
        ),
      );
      const state = new AppState();
      const service = new EditingService(state);
      const pending = service.execute("import_assets", { paths: [path] });
      state.executeProjectChange((project) => {
        project.name = "Manual edit";
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

it("does not publish a cancelled media import", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  const before = state.snapshot();
  const controller = new AbortController();
  controller.abort();
  expect(
    await service.execute(
      "import_assets",
      { paths: ["/cancelled.png"] },
      undefined,
      { signal: controller.signal },
    ),
  ).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
  expect(state.snapshot()).toEqual(before);
});
