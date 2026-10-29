/** @vitest-environment node */
import { expect, it } from "vitest";
import { graphicTemplates } from "../graphic-catalog";
import { EditingService } from "../editing-service";
import { AppState } from "../state";

it("creates four editable presets and retains multiline wording and explicit animation choices", async () => {
  const templates = graphicTemplates();
  expect(templates.map((template) => template.template_id)).toEqual([
    "title-card",
    "lower-third",
    "brand-overlay",
    "ending-card",
  ]);
  const state = new AppState();
  const service = new EditingService(state);
  for (const template of templates) {
    const result = await service.execute("add_graphic_item", {
      templateId: template.template_id,
      trackId: "graphics",
      timelineStartUs: templates.indexOf(template) * 2000000,
      durationUs: 2000000,
      props: {
        title: "After\ndark.",
        alignment: "center",
        animation: "fade",
      },
    });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  }
  const item = state.project.timeline.tracks[0].items[0];
  if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
  expect(item.RemotionGraphic.props).toMatchObject({
    title: "After\ndark.",
    alignment: "center",
    animation: "fade",
  });
  const before = state.snapshot();
  expect(
    await service.execute("update_item", {
      itemId: item.RemotionGraphic.id,
      patch: {
        kind: "RemotionGraphic",
        changes: { props: { animation: "unknown" } },
      },
    }),
  ).toMatchObject({ ok: false });
  expect(state.snapshot()).toEqual(before);
});
