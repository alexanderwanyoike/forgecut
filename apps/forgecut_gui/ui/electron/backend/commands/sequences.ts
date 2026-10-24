import { randomUUID } from "node:crypto";
import {
  projectSequences,
  findProjectSequence,
} from "../../domain/project-sequences.js";
import { EditingError } from "../editing-error.js";
import type { CommandMap, ProjectSequence } from "../../shared/ipc-contract.js";
import type { CommandRegistry } from "./types.js";

export const sequenceCommands = {
  delete_sequence: (args, { state }) => {
    const input = args as CommandMap["delete_sequence"]["args"];
    state.executeProjectChange((project) => {
      if (project.default_sequence?.id === input.sequenceId)
        throw new EditingError(
          "INVALID_INPUT",
          "The default sequence cannot be deleted",
        );
      const found = findProjectSequence(project, input.sequenceId);
      if (!found.ok) throw new EditingError("NOT_FOUND", found.error.message);
      project.sequences = project.sequences!.filter(
        (sequence) => sequence.id !== input.sequenceId,
      );
    });
  },
  get_sequences: (_args, { state }) =>
    projectSequences(state.project).map(({ id, name, settings }) => ({
      id,
      name,
      settings,
    })),
  rename_sequence: (args, { state }) => {
    const input = args as CommandMap["rename_sequence"]["args"];
    state.executeProjectChange((project) => {
      const found = findProjectSequence(project, input.sequenceId);
      if (!found.ok) throw new EditingError("NOT_FOUND", found.error.message);
      if (project.default_sequence?.id === input.sequenceId)
        project.default_sequence.name = input.name;
      else found.value.name = input.name;
    });
    return projectSequences(state.project).find(
      (sequence) => sequence.id === input.sequenceId,
    )!;
  },
  create_sequence: (args, { state }) => {
    const input = args as CommandMap["create_sequence"]["args"];
    const sequence: ProjectSequence = {
      id: randomUUID(),
      name: input.name,
      settings: { ...state.project.settings, ...input.settings },
      timeline: { tracks: [], markers: [] },
    };
    state.executeProjectChange((project) => {
      project.sequences ??= [];
      project.sequences.push(sequence);
    });
    return state.project.sequences!.at(-1)!;
  },
} satisfies CommandRegistry;
