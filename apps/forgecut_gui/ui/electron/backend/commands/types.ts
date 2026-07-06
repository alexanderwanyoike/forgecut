import type { CommandArgs, CommandContext, CommandHandler } from "../ipc.js";

export type CommandRegistry = Record<string, CommandHandler>;

export function requiredString(args: CommandArgs, key: string): string {
  const value = args?.[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required string argument: ${key}`);
  }
  return value;
}

export function requiredNumber(args: CommandArgs, key: string): number {
  const value = args?.[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Missing required number argument: ${key}`);
  }
  return value;
}

export function optionalString(args: CommandArgs, key: string): string | undefined {
  const value = args?.[key];
  return typeof value === "string" ? value : undefined;
}

export function requiredStringArray(args: CommandArgs, key: string): string[] {
  const value = args?.[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Missing required string array argument: ${key}`);
  }
  return value;
}

export type { CommandArgs, CommandContext, CommandHandler };
