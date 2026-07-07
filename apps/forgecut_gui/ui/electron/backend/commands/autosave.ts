import type { CommandRegistry } from "./types.js";

export const autosaveCommands = {
  autosave: (_args, { state }) => state.autosave(),
} satisfies CommandRegistry;
