/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { exportProject } from "../exporter";

function ffmpeg(args: string[]) {
  const run = spawnSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-threads",
    "1",
    "-filter_threads",
    "1",
    ...args,
  ]);
  if (run.status !== 0) throw new Error(run.stderr.toString());
  return run.stdout;
}
it.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)(
  "renders shared crop, fit, position, opacity and layer order with transparent contain padding",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgecut-placement-"));
    try {
      const blue = join(directory, "blue.mkv");
      const green = join(directory, "green.mkv");
      const white = join(directory, "white.png");
      ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=64x36:r=10:d=1",
        "-c:v",
        "ffv1",
        "-threads",
        "1",
        blue,
      ]);
      ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=c=lime:s=16x32:r=10:d=1",
        "-c:v",
        "ffv1",
        "-threads",
        "1",
        green,
      ]);
      ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=c=white:s=16x32",
        "-frames:v",
        "1",
        "-threads",
        "1",
        white,
      ]);
      const state = new AppState();
      const service = new EditingService(state);
      await service.execute("update_project", {
        settings: { width: 64, height: 36, fps: 10 },
      });
      await service.execute("init_default_tracks");
      await service.execute("add_track", { kind: "Video" });
      await service.execute("import_assets", { paths: [blue, green, white] });
      const [baseAsset, pipAsset, imageAsset] = state.project.assets;
      const videos = state.project.timeline.tracks.filter(
        (track) => track.kind === "Video",
      );
      await service.execute("add_clip_to_timeline", {
        assetId: baseAsset.id,
        trackId: videos[0].id,
        timelineStartUs: 0,
      });
      await service.execute("add_clip_to_timeline", {
        assetId: pipAsset.id,
        trackId: videos[1].id,
        timelineStartUs: 0,
      });
      const item = state.project.timeline.tracks.find(
        (track) => track.id === videos[1].id,
      )!.items[0];
      if (!("VideoClip" in item)) throw new Error("Invalid picture fixture");
      const transform = {
        x: 16,
        y: 4,
        width: 32,
        height: 24,
        fit: "cover",
        opacity: 0.5,
      };
      expect(
        await service.execute("update_item", {
          itemId: item.VideoClip.id,
          patch: { kind: "VideoClip", changes: { transform, layer_order: 2 } },
        }),
      ).toMatchObject({ ok: true });
      await service.execute("add_image_overlay", {
        assetId: imageAsset.id,
        timelineStartUs: 0,
        durationUs: 1000000,
        x: 16,
        y: 4,
        width: 32,
        height: 24,
        opacity: 0.5,
      });
      const image = state.project.timeline.tracks
        .flatMap((track) => track.items)
        .find((candidate) => "ImageOverlay" in candidate)!;
      if (!("ImageOverlay" in image))
        throw new Error("Invalid artwork fixture");
      await service.execute("update_item", {
        itemId: image.ImageOverlay.id,
        patch: { kind: "ImageOverlay", changes: { layer_order: -1 } },
      });
      await service.execute("add_text_overlay", {
        trackId: "title",
        timelineStartUs: 0,
        durationUs: 1000000,
        text: "X",
        fontSize: 14,
        color: "#ff0000",
        x: 0,
        y: 0,
      });
      const title = state.project.timeline.tracks.find(
        (track) => track.id === "title",
      )!.items[0];
      if (!("TextOverlay" in title)) throw new Error("Invalid title fixture");
      await service.execute("update_item", {
        itemId: title.TextOverlay.id,
        patch: { kind: "TextOverlay", changes: { layer_order: -2 } },
      });
      const render = async (name: string) => {
        const output = join(directory, `${name}.mp4`);
        expect(await exportProject(state.project, output)).toMatchObject({
          ok: true,
        });
        return ffmpeg([
          "-i",
          output,
          "-frames:v",
          "1",
          "-an",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "pipe:1",
        ]);
      };
      const pixel = (bytes: Buffer, x: number, y: number) => [
        ...bytes.subarray((y * 64 + x) * 3, (y * 64 + x) * 3 + 3),
      ];
      const cover = await render("cover");
      const [red, g, b] = pixel(cover, 18, 10);
      expect(red).toBeLessThan(15);
      expect(g).toBeGreaterThan(90);
      expect(b).toBeGreaterThan(90);
      expect(
        Math.max(...cover.filter((_value, index) => index % 3 === 0)),
      ).toBeLessThan(25);
      await service.execute("update_item", {
        itemId: item.VideoClip.id,
        patch: {
          kind: "VideoClip",
          changes: { transform: { ...transform, fit: "contain" } },
        },
      });
      const contain = await render("contain");
      expect(pixel(contain, 18, 10)[2]).toBeGreaterThan(230);
      expect(pixel(contain, 18, 10)[1]).toBeLessThan(15);
      expect(pixel(contain, 32, 10)[1]).toBeGreaterThan(90);
      await service.execute("delete_clip", { itemId: item.VideoClip.id });
      await service.execute("update_item", {
        itemId: image.ImageOverlay.id,
        patch: {
          kind: "ImageOverlay",
          changes: { layer_order: 2, fit: "contain" },
        },
      });
      const artwork = await render("artwork");
      expect(pixel(artwork, 18, 10)[2]).toBeGreaterThan(230);
      expect(pixel(artwork, 18, 10)[0]).toBeLessThan(15);
      expect(pixel(artwork, 32, 10)[0]).toBeGreaterThan(90);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
