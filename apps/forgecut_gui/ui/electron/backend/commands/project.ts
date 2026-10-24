import type { CommandMap } from "../../shared/ipc-contract.js";
import { requiredString, type CommandRegistry } from "./types.js";

export const projectCommands = {
  get_editing_context: (_args, { state }) => state.getEditingContext(),
  set_editing_context: (args, { state, sequenceId }) =>
    state.setEditingContext(
      args as CommandMap["set_editing_context"]["args"],
      sequenceId,
    ),
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
      if (args?.settings)
        Object.assign(state.sequenceIn(project).settings, args.settings);
    }),

  get_project_settings: (_args, { state, sequenceId }) =>
    state.sequenceIn(state.project, sequenceId ?? state.activeSequence.id)
      .settings,
} satisfies CommandRegistry;
