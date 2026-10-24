import {
  projectSequences,
  findProjectSequence,
} from "../../domain/project-sequences.js";
import { EditingError } from "../editing-error.js";
import { randomUUID } from "node:crypto";
import type { CommandMap, ProjectSequence } from "../../shared/ipc-contract.js";
import type { CommandRegistry } from "./types.js";

export const sequenceCommands = {
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
