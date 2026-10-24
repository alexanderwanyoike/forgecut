import { randomUUID } from "node:crypto";
import type { GraphicValues } from "../../shared/graphics.js";
import { graphicTemplates } from "../graphic-catalog.js";
import { validateGraphicProperties } from "../../domain/graphic-properties.js";
import { addItem } from "../timeline-ops.js";
import {
  requiredNumber,
  requiredString,
  type CommandRegistry,
} from "./types.js";

export const graphicsCommands = {
  get_graphic_components: () => graphicTemplates(),
  add_graphic_item: (args, { state }) =>
    state.executeProjectChange((project) => {
      const templateId = requiredString(args, "templateId");
      const template = graphicTemplates().find(
        (candidate) => candidate.template_id === templateId,
      );
      if (!template) throw new Error("Unknown graphic template");
      project.components ??= [];
      let component = project.components.find(
        (candidate) =>
          candidate.template_id === templateId &&
          candidate.version === template.version,
      );
      if (!component) {
        component = { ...template, id: randomUUID() };
        project.components.push(component);
      }
      const defaults = Object.fromEntries(
        Object.entries(component.properties).map(([key, value]) => [
          key,
          value.default,
        ]),
      );
      const sx = project.settings.width / component.design_size.width;
      const sy = project.settings.height / component.design_size.height;
      for (const layer of component.layers) {
        for (const [key, scale] of [
          [layer.bindings.x, sx],
          [layer.bindings.width, sx],
          [layer.bindings.y, sy],
          [layer.bindings.height, sy],
          [layer.bindings.font_size, Math.min(sx, sy)],
        ] as const) {
          const value = defaults[key];
          if (typeof value === "number") defaults[key] = value * scale;
        }
      }
      const props = validateGraphicProperties(component, {
        ...defaults,
        ...(args?.props as GraphicValues | undefined),
      });
      if (!props.ok) throw new Error(props.error.message);
      const trackId = requiredString(args, "trackId");
      if (!project.timeline.tracks.some((track) => track.id === trackId))
        project.timeline.tracks.push({
          id: trackId,
          kind: "Graphics",
          items: [],
        });
      addItem(project.timeline, trackId, {
        RemotionGraphic: {
          id: randomUUID(),
          track_id: trackId,
          timeline_start_us: requiredNumber(args, "timelineStartUs"),
          duration_us: requiredNumber(args, "durationUs"),
          component_id: component.id,
          component_version: component.version,
          props: props.value,
        },
      });
    }).timeline,
} satisfies CommandRegistry;
