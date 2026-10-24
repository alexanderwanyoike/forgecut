import { randomUUID } from "node:crypto";
import type { CommandMap, ProjectSequence } from "../../shared/ipc-contract.js";
import { findProjectSequence } from "../../domain/project-sequences.js";
import { itemData } from "../../domain/timeline-item.js";
import { syncVariantTiming } from "../../domain/variant-timing.js";
import { EditingError } from "../editing-error.js";
import type { CommandRegistry } from "./types.js";

export const variantCommands = {
  create_sequence_variant: (args, { state }) => {
    const input = args as CommandMap["create_sequence_variant"]["args"];
    const original = state.sequenceIn(state.project, input.sourceSequenceId);
    const timeline = structuredClone(original.timeline);
    for (const track of timeline.tracks) {
      track.id = randomUUID();
      for (const item of track.items) {
        const data = itemData(item);
        data.origin_item_id = data.id;
        data.id = randomUUID();
        data.track_id = track.id;
      }
    }
    const variant: ProjectSequence = {
      id: randomUUID(),
      name: input.name,
      variant_source: { sequence_id: original.id },
      settings: { ...original.settings, ...input.settings },
      timeline,
    };
    state.executeProjectChange((project) => {
      project.sequences ??= [];
      project.sequences.push(variant);
    });
    return state.project.sequences!.at(-1)!;
  },
  sync_variant_timing: (args, { state }) => {
    const input = args as CommandMap["sync_variant_timing"]["args"];
    const targetId = state.activeSequence.id;
    state.executeProjectChange((project) => {
      const target = state.sequenceIn(project, targetId);
      if (
        !target.variant_source ||
        target.variant_source.sequence_id === target.id
      )
        throw new EditingError(
          "INVALID_INPUT",
          "Choose a variant with an originating sequence",
        );
      const source = findProjectSequence(
        project,
        target.variant_source.sequence_id,
      );
      if (!source.ok)
        throw new EditingError(
          "NOT_FOUND",
          "The originating sequence is unavailable",
        );
      const result = syncVariantTiming(target, source.value, input.itemIds);
      if (!result.ok)
        throw new EditingError(
          result.error.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_INPUT",
          result.error.message,
        );
    });
  },
} satisfies CommandRegistry;
