import type { CommandMap } from "../../shared/ipc-contract.js";
import type { GraphicDraft } from "../../shared/graphic-draft.js";
import { resolveGraphicInstance } from "../../domain/graphic-instance.js";
import { prepareGraphicPromotion } from "../graphic-promotion-candidate.js";
import { readGraphicTypeLibraries } from "../graphic-type-libraries.js";
import { graphicPreviewError } from "../graphic-preview-error.js";
import { EditingError } from "../editing-error.js";
import type { CommandRegistry } from "./types.js";

export const graphicEditorCommands = {
  get_graphic_type_libraries: async () => {
    const result = await readGraphicTypeLibraries();
    if (!result.ok)
      throw new EditingError(result.error.code, result.error.message);
    return result.value;
  },
  get_graphic_draft_preview: async (
    args,
    { state, drafts, preview, signal },
  ) => {
    if (!drafts || !preview)
      throw new EditingError("UNAVAILABLE", "Draft preview is unavailable");
    const input = args as CommandMap["get_graphic_draft_preview"]["args"];
    const assertBase = () => {
      state.assertSession(input.sessionId);
      if (state.revision !== input.expectedRevision)
        throw new EditingError(
          "CONFLICT",
          "Project changed while preparing draft preview",
        );
    };
    assertBase();
    const snapshot = state.project;
    const resolved = resolveGraphicInstance(snapshot, input.itemId);
    if (!resolved.ok)
      throw new EditingError(resolved.error.code, resolved.error.message);
    const initial: GraphicDraft = {
      projectId: snapshot.id,
      itemId: input.itemId,
      baseVersion: resolved.value.component.version,
      revision: 0,
      component: resolved.value.component,
    };
    const draft = await drafts.read(initial);
    if (!draft.ok)
      throw new EditingError(draft.error.code, draft.error.message);
    if (draft.value.revision !== input.expectedDraftRevision)
      throw new EditingError("CONFLICT", "The source draft changed");
    const candidate = prepareGraphicPromotion(snapshot, draft.value, {
      itemId: input.itemId,
      mappings: input.mappings,
    });
    if (!candidate.ok)
      throw new EditingError(
        candidate.error.code === "CONFLICT" ? "CONFLICT" : "INVALID_INPUT",
        candidate.error.message,
      );
    const frame = await preview.render(
      candidate.value.project,
      input.sessionId,
      input.itemId,
      undefined,
      input.frame,
      signal,
    );
    if (!frame.ok) throw graphicPreviewError(frame.error);
    const latest = await drafts.read(initial);
    assertBase();
    if (!latest.ok)
      throw new EditingError(latest.error.code, latest.error.message);
    if (latest.value.revision !== input.expectedDraftRevision)
      throw new EditingError(
        "CONFLICT",
        "Draft changed while rendering preview",
      );
    return frame.value;
  },
} satisfies CommandRegistry;
