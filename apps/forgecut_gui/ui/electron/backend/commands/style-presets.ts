import { randomUUID } from "node:crypto";
import { scaleGraphicProperties } from "../../domain/graphic-scale.js";
import type { CommandMap } from "../../shared/ipc-contract.js";
import type { StylePreset } from "../../shared/style-presets.js";
import { addItem } from "../timeline-ops.js";
import { EditingError } from "../editing-error.js";
import type { CommandRegistry } from "./types.js";

export const stylePresetCommands = {
  delete_style_preset: (args, { state }) => {
    const input = args as CommandMap["delete_style_preset"]["args"];
    state.executeProjectChange((project) => {
      if (!project.style_presets?.some((value) => value.id === input.presetId))
        throw new EditingError("NOT_FOUND", "Style preset not found");
      project.style_presets = project.style_presets.filter(
        (value) => value.id !== input.presetId,
      );
    });
  },
  save_style_preset: (args, { state }) => {
    const input = args as CommandMap["save_style_preset"]["args"];
    const sourceSequence = state.sequenceIn(
      state.project,
      input.sourceSequenceId,
    );
    const source = sourceSequence.timeline.tracks
      .flatMap((track) => track.items)
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
      id: input.presetId ?? randomUUID(),
      canvas_size: {
        width: sourceSequence.settings.width,
        height: sourceSequence.settings.height,
      },
      ...(source.RemotionGraphic.layer_states
        ? { layer_states: structuredClone(source.RemotionGraphic.layer_states) }
        : {}),
      ...(source.RemotionGraphic.transform
        ? { transform: structuredClone(source.RemotionGraphic.transform) }
        : {}),
      name: input.name,
      purpose: input.purpose,
      component_id: source.RemotionGraphic.component_id,
      component_version: source.RemotionGraphic.component_version,
      props: structuredClone(source.RemotionGraphic.props),
    };
    state.executeProjectChange((project) => {
      project.style_presets ??= [];
      if (input.presetId) {
        const index = project.style_presets.findIndex(
          (value) => value.id === input.presetId,
        );
        if (index < 0)
          throw new EditingError("NOT_FOUND", "Style preset not found");
        project.style_presets[index] = preset;
      } else project.style_presets.push(preset);
    });
    return state.project.style_presets!.find(
      (value) => value.id === preset.id,
    )!;
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
      const component = project.components!.find(
        (value) =>
          value.id === preset.component_id &&
          value.version === preset.component_version,
      )!;
      const sx = sequence.settings.width / preset.canvas_size.width;
      const sy = sequence.settings.height / preset.canvas_size.height;
      const transform = preset.transform
        ? {
            ...preset.transform,
            x: preset.transform.x * sx,
            y: preset.transform.y * sy,
            width: preset.transform.width * sx,
            height: preset.transform.height * sy,
          }
        : undefined;
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
          props: {
            ...scaleGraphicProperties(
              component,
              preset.props,
              preset.canvas_size,
              sequence.settings,
            ),
            ...input.overrides,
          },
          ...(preset.layer_states
            ? { layer_states: structuredClone(preset.layer_states) }
            : {}),
          ...(transform ? { transform } : {}),
        },
      });
    });
    return state.activeSequence.timeline;
  },
} satisfies CommandRegistry;
