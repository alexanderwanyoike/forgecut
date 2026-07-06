import { requiredString, type CommandRegistry } from "./types.js";

export const projectCommands: CommandRegistry = {
  create_project: (_args, { state }) => JSON.stringify(state.createProject()),

  save_project: (args, { state }) =>
    state.saveProject(requiredString(args, "path")),

  load_project: async (args, { state }) =>
    JSON.stringify(await state.loadProject(requiredString(args, "path"))),

  get_project_settings: (_args, { state }) => state.project.settings,
};
