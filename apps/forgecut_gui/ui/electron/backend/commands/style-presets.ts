import { randomUUID } from "node:crypto";
import type { CommandMap } from "../../shared/ipc-contract.js";
import type { StylePreset } from "../../shared/style-presets.js";
import { addItem } from "../timeline-ops.js";
import { EditingError } from "../editing-error.js";
import type { CommandRegistry } from "./types.js";

export const stylePresetCommands = {
  save_style_preset: (args, { state }) => {
    const input = args as CommandMap["save_style_preset"]["args"];
    const source = state
      .sequenceIn(state.project, input.sourceSequenceId)
      .timeline.tracks.flatMap((track) => track.items)
      .find(
        (item) =>
          "RemotionGraphic" in item && item.RemotionGraphic.id === input.itemId,
      );
    if (!source || !("RemotionGraphic" in source))
      throw new EditingError(
        "NOT_FOUND",
        "Choose a graphic in the source sequence",
      );
    const preset: StylePreset = {
      id: randomUUID(),
      name: input.name,
      purpose: input.purpose,
      component_id: source.RemotionGraphic.component_id,
      component_version: source.RemotionGraphic.component_version,
      props: structuredClone(source.RemotionGraphic.props),
    };
    state.executeProjectChange((project) => {
      project.style_presets ??= [];
      project.style_presets.push(preset);
    });
    return state.project.style_presets!.at(-1)!;
  },
  add_graphic_from_preset: (args, { state }) => {
    const input = args as CommandMap["add_graphic_from_preset"]["args"];
    state.executeProjectChange((project) => {
      const preset = project.style_presets?.find(
        (value) => value.id === input.presetId,
      );
      if (!preset)
        throw new EditingError("NOT_FOUND", "Style preset not found");
      const sequence = state.sequenceIn(project);
      if (!sequence.timeline.tracks.some((track) => track.id === input.trackId))
        sequence.timeline.tracks.push({
          id: input.trackId,
          kind: "Graphics",
          items: [],
        });
      addItem(sequence.timeline, input.trackId, {
        RemotionGraphic: {
          id: randomUUID(),
          track_id: input.trackId,
          timeline_start_us: input.timelineStartUs,
          duration_us: input.durationUs,
          component_id: preset.component_id,
          component_version: preset.component_version,
          props: { ...preset.props, ...input.overrides },
        },
      });
    });
    return state.activeSequence.timeline;
  },
} satisfies CommandRegistry;
