import { scaleGraphicProperties } from "../../domain/graphic-scale.js";
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
  add_graphic_item: (args, { state }) => {
    state.executeProjectChange((project) => {
      const sequence = state.sequenceIn(project);
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
      const props = validateGraphicProperties(component, {
        ...scaleGraphicProperties(
          component,
          defaults,
          component.design_size,
          sequence.settings,
        ),
        ...(args?.props as GraphicValues | undefined),
      });
      if (!props.ok) throw new Error(props.error.message);
      const trackId = requiredString(args, "trackId");
      if (!sequence.timeline.tracks.some((track) => track.id === trackId))
        sequence.timeline.tracks.push({
          id: trackId,
          kind: "Graphics",
          items: [],
        });
      addItem(sequence.timeline, trackId, {
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
    });
    return state.activeSequence.timeline;
  },
} satisfies CommandRegistry;
