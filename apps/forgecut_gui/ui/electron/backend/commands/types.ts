import type { GraphicDraftStore } from "../GraphicDraftStore.js";
import type { GraphicPreviewService } from "../GraphicPreviewService.js";
import type { AppState } from "../state.js";

export type CommandArgs = Record<string, unknown> | undefined;
export type CommandContext = {
  state: AppState;
  preview?: GraphicPreviewService;
  drafts?: GraphicDraftStore;
  signal?: AbortSignal;
  beginCommit?: () => boolean;
  onProgress?: (progress: number) => void;
};
export type CommandHandler = (
  args: CommandArgs,
  context: CommandContext,
) => unknown;

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

export function optionalString(
  args: CommandArgs,
  key: string,
): string | undefined {
  const value = args?.[key];
  return typeof value === "string" ? value : undefined;
}

export function requiredStringArray(args: CommandArgs, key: string): string[] {
  const value = args?.[key];
  if (
    !Array.isArray(value) ||
    !value.every((item: unknown): item is string => typeof item === "string")
  ) {
    throw new Error(`Missing required string array argument: ${key}`);
  }
  return value;
}
