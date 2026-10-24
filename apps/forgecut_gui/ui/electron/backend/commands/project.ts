import { requiredString, type CommandRegistry } from "./types.js";

export const projectCommands = {
  create_project: (_args, { state }) => JSON.stringify(state.createProject()),

  save_project: (args, { state }) =>
    state.saveProject(requiredString(args, "path")),

  load_project: async (args, { state }) =>
    JSON.stringify(await state.loadProject(requiredString(args, "path"))),

  recover_project: async (args, { state }) =>
    JSON.stringify(await state.loadProject(requiredString(args, "path"), true)),

  update_project: (args, { state }) =>
    state.executeProjectChange((project) => {
      if (typeof args?.name === "string") project.name = args.name;
      if (args?.settings) Object.assign(project.settings, args.settings);
    }),

  get_project_settings: (_args, { state }) => state.project.settings,
} satisfies CommandRegistry;
