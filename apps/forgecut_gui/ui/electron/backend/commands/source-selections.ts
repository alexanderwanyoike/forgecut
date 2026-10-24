import { randomUUID } from "node:crypto";
import type { CommandMap } from "../../shared/ipc-contract.js";
import type { SourceSelection } from "../../shared/source-selection.js";
import { EditingError } from "../editing-error.js";
import type { CommandRegistry } from "./types.js";

export const sourceSelectionCommands = {
  save_source_selection: (args, { state }) => {
    const input = args as CommandMap["save_source_selection"]["args"];
    const selection: SourceSelection = {
      id: input.selectionId ?? randomUUID(),
      asset_id: input.assetId,
      name: input.name,
      source_in_us: input.sourceInUs,
      source_out_us: input.sourceOutUs,
      notes: input.notes,
      rationale: input.rationale,
    };
    state.executeProjectChange((project) => {
      project.source_selections ??= [];
      if (input.selectionId) {
        const index = project.source_selections.findIndex(
          (value) => value.id === input.selectionId,
        );
        if (index < 0)
          throw new EditingError("NOT_FOUND", "Source selection not found");
        project.source_selections[index] = selection;
      } else project.source_selections.push(selection);
    });
    return state.project.source_selections!.find(
      (value) => value.id === selection.id,
    )!;
  },
  delete_source_selection: (args, { state }) => {
    const input = args as CommandMap["delete_source_selection"]["args"];
    state.executeProjectChange((project) => {
      if (
        !project.source_selections?.some(
          (value) => value.id === input.selectionId,
        )
      )
        throw new EditingError("NOT_FOUND", "Source selection not found");
      project.source_selections = project.source_selections.filter(
        (value) => value.id !== input.selectionId,
      );
    });
  },
} satisfies CommandRegistry;
