import type { IpcMainInvokeEvent } from "electron";
import type {
  CommandMetadata,
  CommandResponse,
} from "../shared/ipc-contract.js";
import type { EditingService } from "./editing-service.js";
export type {
  CommandArgs,
  CommandContext,
  CommandHandler,
} from "./commands/types.js";

export function dispatchCommand(
  event: IpcMainInvokeEvent,
  service: EditingService,
  command: string,
  args?: unknown,
  metadata?: CommandMetadata,
): Promise<CommandResponse> {
  return service.execute(command, args, metadata, (name, payload) => {
    if (!event.sender.isDestroyed())
      event.sender.send(`forgecut:event:${name}`, payload);
  });
}
