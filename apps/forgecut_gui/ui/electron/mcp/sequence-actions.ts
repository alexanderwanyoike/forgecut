import type { AppState } from "../backend/state.js";
import {
  projectForSequence,
  projectSequences,
} from "../domain/project-sequences.js";
import {
  itemData,
  timelineEndUs,
  timelineStartUs,
} from "../domain/timeline-item.js";
import { resolveSequenceFrame } from "../domain/sequence.js";
import type { BridgeResult } from "./contract.js";
import type { SequenceAction } from "./sequence-schema.js";

export function dispatchSequenceAction(
  state: AppState,
  request: SequenceAction,
): BridgeResult {
  if (request.action === "sequences") {
    const sequences = projectSequences(state.project);
    return {
      ok: true,
      value: {
        sessionId: state.sessionId,
        revision: state.revision,
        activeSequenceId: state.getEditingContext().activeSequenceId,
        sequenceRevision: state.getEditingContext().sequenceRevision,
        defaultSequenceId: sequences[0].id,
        total: sequences.length,
        sequences: sequences
          .slice(request.offset, request.offset + request.limit)
          .map(({ id, name, settings, variant_source }) => ({
            id,
            name,
            settings,
            ...(variant_source
              ? { variantSourceSequenceId: variant_source.sequence_id }
              : {}),
          })),
      },
    };
  }
  if (request.action === "select-sequence") {
    if (
      state.getEditingContext().sequenceRevision !==
      request.expectedSequenceRevision
    )
      return {
        ok: false,
        error: {
          code: "CONFLICT",
          message:
            "The active sequence changed. Read editing context before selecting a sequence.",
        },
      };
    return {
      ok: true,
      value: state.selectSequence(request.sessionId, request.sequenceId),
    };
  }
  if (request.action === "item" && !request.sequenceId) {
    for (const sequence of projectSequences(state.project)) {
      const item = sequence.timeline.tracks
        .flatMap((track) => track.items)
        .find((candidate) => itemData(candidate).id === request.itemId);
      if (item)
        return {
          ok: true,
          value: {
            sessionId: state.sessionId,
            revision: state.revision,
            sequenceId: sequence.id,
            item,
          },
        };
    }
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Timeline item not found." },
    };
  }
  if (!request.sequenceId && (state.project.sequences?.length ?? 0) > 0)
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message:
          "Provide a sequence ID before reading a multi-sequence timeline.",
      },
    };
  const sequenceId =
    request.sequenceId ??
    state.project.default_sequence?.id ??
    state.project.id;
  const selected = projectForSequence(state.project, sequenceId);
  if (!selected.ok) return selected;
  const metadata = {
    sessionId: state.sessionId,
    revision: state.revision,
    sequenceId,
  };
  if (request.action === "sequence") {
    const { layers, ...frame } = resolveSequenceFrame(
      selected.value,
      request.playheadUs,
    );
    return {
      ok: true,
      value: {
        ...metadata,
        ...frame,
        total: layers.length,
        layers: layers.slice(request.offset, request.offset + request.limit),
      },
    };
  }
  const items = selected.value.timeline.tracks.flatMap((track) => track.items);
  if (request.action === "item") {
    const item = items.find(
      (candidate) => itemData(candidate).id === request.itemId,
    );
    return item
      ? { ok: true, value: { ...metadata, item } }
      : {
          ok: false,
          error: { code: "NOT_FOUND", message: "Timeline item not found." },
        };
  }
  if (request.endUs <= request.startUs)
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Timeline range must have a positive duration.",
      },
    };
  const matching = items.filter(
    (item) =>
      timelineStartUs(item) < request.endUs &&
      timelineEndUs(item) > request.startUs,
  );
  return {
    ok: true,
    value: {
      ...metadata,
      total: matching.length,
      items: matching.slice(request.offset, request.offset + request.limit),
    },
  };
}
