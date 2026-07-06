import type { CommandRegistry } from "./types.js";

export const autosaveCommands: CommandRegistry = {
  autosave: (_args, { state }) => state.autosave(),
};
