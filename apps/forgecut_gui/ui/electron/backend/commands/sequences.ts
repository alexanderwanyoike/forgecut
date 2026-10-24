import { randomUUID } from "node:crypto";
import type { CommandMap, ProjectSequence } from "../../shared/ipc-contract.js";
import type { CommandRegistry } from "./types.js";

export const sequenceCommands = {
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
