import type { GraphicComponent } from "../../shared/graphics.js";
import type { GraphicDraft } from "../../shared/graphic-draft.js";
import type { GraphicDraftStore } from "../GraphicDraftStore.js";
import { EditingError } from "../editing-error.js";
import type { AppState } from "../state.js";
import {
  requiredString,
  requiredNumber,
  type CommandRegistry,
} from "./types.js";

function initialDraft(state: AppState, itemId: string): GraphicDraft {
  const found = state.project.timeline.tracks
    .flatMap((track) => track.items)
    .find(
      (item) => "RemotionGraphic" in item && item.RemotionGraphic.id === itemId,
    );
  if (!found || !("RemotionGraphic" in found))
    throw new EditingError("NOT_FOUND", "Graphic instance not found");
  const graphic = found.RemotionGraphic;
  const component = state.project.components?.find(
    (candidate) =>
      candidate.id === graphic.component_id &&
      candidate.version === graphic.component_version,
  );
  if (!component)
    throw new EditingError("NOT_FOUND", "Graphic component not found");
  return {
    projectId: state.project.id,
    itemId,
    baseVersion: component.version,
    revision: 0,
    component: structuredClone(component),
  };
}

function requireStore(store: GraphicDraftStore | undefined): GraphicDraftStore {
  if (!store)
    throw new EditingError("UNAVAILABLE", "Source drafts are unavailable");
  return store;
}

export const graphicDraftCommands = {
  get_graphic_draft: async (args, { state, drafts }) => {
    const store = requireStore(drafts);
    const result = await store.read(
      initialDraft(state, requiredString(args, "itemId")),
    );
    if (!result.ok)
      throw new EditingError(result.error.code, result.error.message);
    return result.value;
  },
  save_graphic_draft: async (args, { state, drafts }) => {
    const store = requireStore(drafts);
    state.assertSession(requiredString(args, "sessionId"));
    const initial = initialDraft(state, requiredString(args, "itemId"));
    const baseVersion = requiredString(args, "baseVersion");
    if (baseVersion !== initial.baseVersion)
      throw new EditingError(
        "CONFLICT",
        "The active component changed. Revert or reconcile this draft before saving.",
      );
    const result = await store.save(
      initial,
      requiredNumber(args, "expectedDraftRevision"),
      args?.component as GraphicComponent,
      baseVersion,
    );
    if (!result.ok)
      throw new EditingError(result.error.code, result.error.message);
    return result.value;
  },
  revert_graphic_draft: async (args, { state, drafts }) => {
    const store = requireStore(drafts);
    state.assertSession(requiredString(args, "sessionId"));
    const initial = initialDraft(state, requiredString(args, "itemId"));
    const result = await store.save(
      initial,
      requiredNumber(args, "expectedDraftRevision"),
      initial.component,
      initial.baseVersion,
    );
    if (!result.ok)
      throw new EditingError(result.error.code, result.error.message);
    return result.value;
  },
} satisfies CommandRegistry;
