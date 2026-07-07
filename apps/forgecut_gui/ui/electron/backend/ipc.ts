import type { IpcMainInvokeEvent, WebContents } from "electron";
import type { CommandName } from "../shared/ipc-contract.js";
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

// Record<CommandName, ...> makes a contract command without a handler a
// compile error. Handler args stay untyped here because IPC input is
// untrusted; each handler validates at runtime.
const handlers: Record<CommandName, CommandHandler> = {
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
  const handler = handlers[command as CommandName];
  if (!handler) {
    throw new Error(`Unknown Electron command: ${command}`);
  }

  return handler(args, {
    state,
    webContents: event.sender,
  });
}
