/** @vitest-environment node */
import { existsSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

const services: EditingService[] = [];
afterEach(async () => {
  await Promise.all(
    services.splice(0).map((service) => service.closePreviews()),
  );
});

async function serviceWithCard() {
  const state = new AppState();
  const service = new EditingService(state);
  services.push(service);
  await service.execute("update_project", {
    settings: { width: 64, height: 36, fps: 10 },
  });
  await service.execute("add_graphic_item", {
    templateId: "title-card",
    trackId: "graphics",
    timelineStartUs: 0,
    durationUs: 1000000,
  });
  const [card] = state.project.timeline.tracks
    .flatMap((track) => track.items)
    .flatMap((item) =>
      "RemotionGraphic" in item ? [item.RemotionGraphic] : [],
    );
  return { state, service, itemId: card.id };
}

it("refuses to prepare playback for an outdated project revision", async () => {
  const { state, service, itemId } = await serviceWithCard();
  const result = await service.execute("get_graphic_playback", {
    itemId,
    revision: state.revision - 1,
  });
  expect(result).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
});

it.skipIf(process.env.FORGECUT_GRAPHICS_TEST !== "1")(
  "prepares a playable graphic render the editor may serve",
  async () => {
    const { state, service, itemId } = await serviceWithCard();
    const result = await service.execute("get_graphic_playback", {
      itemId,
      revision: state.revision,
    });
    if (!result.ok) throw new Error(result.error.message);
    const { path } = result.value as { path: string };
    expect(path.endsWith(".webm")).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(service.renders.owns(path)).toBe(true);
  },
  60000,
);
