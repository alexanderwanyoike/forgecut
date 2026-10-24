import type { AppState } from "../state.js";
import type { EventPayloads } from "../../shared/ipc-contract.js";

export type CommandArgs = Record<string, unknown> | undefined;
export type EventSink = <E extends keyof EventPayloads>(event: E, payload: EventPayloads[E]) => void;
export type CommandContext = { state: AppState; emit: EventSink };
export type CommandHandler = (args: CommandArgs, context: CommandContext) => Promise<unknown> | unknown;

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
