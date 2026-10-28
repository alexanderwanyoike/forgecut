/** @vitest-environment node */
import { afterEach, expect, it, vi } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";
import { GraphicPreviewService } from "../GraphicPreviewService";
import { GraphicPreviewHost } from "../GraphicPreviewHost";
import * as compiler from "../graphic-source-check";

afterEach(() => vi.restoreAllMocks());

it("reuses unchanged source compilation across cards while retaining separate render identities", async () => {
  const state = new AppState();
  const editor = new EditingService(state);
  const preview = new GraphicPreviewService();
  const compile = vi.spyOn(compiler, "checkGraphicSource").mockResolvedValue({
    ok: true,
    value: { ok: true, value: { code: "compiled component" } },
  });
  const render = vi.spyOn(GraphicPreviewHost.prototype, "render").mockResolvedValue({
    ok: true,
    value: { mimeType: "image/png", data: "AA==", width: 64, height: 36 },
  });
  try {
    for (const [index, title] of ["First card", "Second card"].entries()) {
      const added = await editor.execute("add_graphic_item", {
        templateId: "title-card",
        trackId: "graphics",
        timelineStartUs: index * 2000000,
        durationUs: 1200000,
        props: { title },
      });
      if (!added.ok) throw new Error(added.error.message);
    }
    const cards = state.project.timeline.tracks.flatMap((track) => track.items)
      .flatMap((item) => "RemotionGraphic" in item ? [item.RemotionGraphic] : []);
    for (const card of cards) {
      expect(await preview.render(state.project, state.sessionId, card.id, undefined, 0))
        .toMatchObject({ ok: true });
    }
    expect(compile).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(2);
    const [first, second] = render.mock.calls.map(([input]) => input);
    expect(first.key).not.toBe(second.key);
    expect(first.values.title).toBe("First card");
    expect(second.values.title).toBe("Second card");
  } finally {
    await preview.close();
    await editor.closeGraphicsPreview();
    await editor.jobs.close();
  }
});
