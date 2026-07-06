import type { IpcMainInvokeEvent, WebContents } from "electron";
import type { AppState } from "./state.js";
import { autosaveCommands } from "./commands/autosave.js";
import { exportCommands } from "./commands/export.js";
import { mediaCommands } from "./commands/media.js";
import { projectCommands } from "./commands/project.js";
import { timelineCommands } from "./commands/timeline.js";

export type CommandArgs = Record<string, unknown> | undefined;

export type CommandContext = {
  state: AppState;
  webContents: WebContents;
};

export type CommandHandler = (
  args: CommandArgs,
  context: CommandContext,
) => Promise<unknown> | unknown;

const handlers: Record<string, CommandHandler> = {
  ...projectCommands,
  ...timelineCommands,
  ...mediaCommands,
  ...autosaveCommands,
  ...exportCommands,
};

export async function dispatchCommand(
  event: IpcMainInvokeEvent,
  state: AppState,
  command: string,
  args: CommandArgs = {},
): Promise<unknown> {
  const handler = handlers[command];
  if (!handler) {
    throw new Error(`Electron command not ported yet: ${command}`);
  }

  return handler(args, {
    state,
    webContents: event.sender,
  });
}
