import type { CommandArgs, CommandContext, CommandHandler } from "../ipc.js";

export type CommandRegistry = Record<string, CommandHandler>;

export function requiredString(args: CommandArgs, key: string): string {
  const value = args?.[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required string argument: ${key}`);
  }
  return value;
}

export type { CommandArgs, CommandContext, CommandHandler };
