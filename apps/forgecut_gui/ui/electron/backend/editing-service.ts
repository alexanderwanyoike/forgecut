import { ZodError } from "zod";
import { createHash } from "node:crypto";
import { changedItemIds } from "./project-diff.js";
import type {
  CommandName,
  CommandResponse,
  EditOperation,
  EditRequest,
  ProjectSnapshot,
} from "../shared/ipc-contract.js";
import { JobQueue } from "./job-queue.js";
import { AppState } from "./state.js";
import { EditingError } from "./editing-error.js";
import {
  commandSchemas,
  editRequestSchema,
  historyRequestSchema,
  editSchemas,
  metadataSchema,
} from "./command-schema.js";
import { autosaveCommands } from "./commands/autosave.js";
import { exportCommands } from "./commands/export.js";
import { mediaCommands } from "./commands/media.js";
import { projectCommands } from "./commands/project.js";
import { graphicSourceCommands } from "./commands/graphic-source.js";
import { graphicResourceCommands } from "./commands/graphic-resources.js";
import { graphicsCommands } from "./commands/graphics.js";
import { timelineCommands } from "./commands/timeline.js";
import type { CommandArgs, CommandHandler } from "./commands/types.js";

const handlers: Record<
  Exclude<
    CommandName,
    | "get_project_snapshot"
    | "apply_edits"
    | "apply_history"
    | "export_project"
    | "get_media_job"
    | "cancel_media_job"
  >,
  CommandHandler
> = {
  ...projectCommands,
  ...timelineCommands,
  ...graphicsCommands,
  ...graphicSourceCommands,
  ...graphicResourceCommands,
  ...mediaCommands,
  ...autosaveCommands,
};
type CachedEdit = {
  fingerprint: string;
  snapshot: ProjectSnapshot;
  bytes: number;
};

export class EditingService {
  readonly jobs = new JobQueue();

  private readonly handlers = { ...handlers, ...exportCommands(this.jobs) };

  private requests = new Map<string, CachedEdit>();

  constructor(readonly state: AppState) {}

  async execute(
    command: string,
    input?: unknown,
    metadata?: unknown,
    options: {
      signal?: AbortSignal;
      beginCommit?: () => boolean;
      onProgress?: (progress: number) => void;
    } = {},
  ): Promise<CommandResponse> {
    try {
      if (typeof command !== "string")
        throw new EditingError("INVALID_INPUT", "Command must be a string");
      if (!Object.prototype.hasOwnProperty.call(commandSchemas, command))
        throw new EditingError("NOT_FOUND", `Unknown command: ${command}`);
      const jobControl =
        command === "get_media_job" || command === "cancel_media_job";
      const meta = metadataSchema.parse(metadata);
      if (meta?.sessionId && !jobControl)
        this.state.assertSession(meta.sessionId);
      const args = commandSchemas[command as CommandName].parse(
        input,
      ) as CommandArgs;
      let value: unknown;
      if (command === "apply_edits" || command === "apply_history") {
        const snapshot =
          command === "apply_edits"
            ? this.applyEdits(args as EditRequest)
            : this.applyHistory(args);
        return {
          ok: true,
          value: snapshot,
          sessionId: snapshot.sessionId,
          revision: snapshot.revision,
        };
      }
      if (command === "get_project_snapshot") value = this.state.snapshot();
      else if (Object.prototype.hasOwnProperty.call(editSchemas, command)) {
        this.applyOperations(
          [{ command, args } as EditOperation],
          meta?.editGroup,
        );
        if (command === "update_project") value = this.state.project;
        else if (command === "remove_asset") value = undefined;
        else value = this.state.project.timeline;
      } else {
        const { sessionId } = this.state;
        const { revision } = this.state;
        const derived =
          command === "get_clip_thumbnails" || command === "get_waveform";
        const assetBefore = derived
          ? JSON.stringify(
              this.state.project.assets.find(
                (asset) => asset.id === args?.assetId,
              ),
            )
          : undefined;
        value = await this.handlers[
          command as
            | keyof typeof handlers
            | "export_project"
            | "get_media_job"
            | "cancel_media_job"
        ](args, {
          state: this.state,
          ...options,
        });
        if (
          !jobControl &&
          command !== "export_project" &&
          !["create_project", "load_project", "recover_project"].includes(
            command,
          )
        )
          this.state.assertSession(sessionId);
        const assetUnchanged =
          derived &&
          assetBefore ===
            JSON.stringify(
              this.state.project.assets.find(
                (asset) => asset.id === args?.assetId,
              ),
            );
        if (
          !jobControl &&
          command.startsWith("get_") &&
          revision !== this.state.revision &&
          !assetUnchanged
        )
          throw new EditingError(
            "CONFLICT",
            "The project changed while reading. Read it again.",
          );
      }
      return {
        ok: true,
        value: structuredClone(value),
        sessionId: this.state.sessionId,
        revision: this.state.revision,
      };
    } catch (error) {
      if (error instanceof EditingError)
        return {
          ok: false,
          error: { code: error.code, message: error.message },
        };
      const io = (error as NodeJS.ErrnoException)?.code;
      return {
        ok: false,
        error: {
          code: io ? "IO_ERROR" : "INVALID_INPUT",
          message:
            error instanceof ZodError
              ? error.issues
                  .map(
                    (issue) =>
                      `${issue.path.join(".") || "input"}: ${issue.message}`,
                  )
                  .join("; ")
              : String(error instanceof Error ? error.message : error),
        },
      };
    }
  }

  applyEdits(input: EditRequest): ProjectSnapshot {
    const request = editRequestSchema.parse(input);
    request.operations = request.operations.map((operation) => ({
      ...operation,
      args: editSchemas[operation.command].parse(operation.args),
    }));
    return this.executeGuarded(request, () =>
      this.applyOperations(
        request.operations as EditOperation[],
        request.editGroup,
      ),
    );
  }

  private applyHistory(input: unknown): ProjectSnapshot {
    const request = historyRequestSchema.parse(input);
    return this.executeGuarded(request, () => {
      if (request.direction === "undo") this.state.undo();
      else this.state.redo();
    });
  }

  private executeGuarded(
    request: { sessionId: string; expectedRevision: number; requestId: string },
    change: () => void,
  ): ProjectSnapshot {
    this.state.assertSession(request.sessionId);
    const key = `${request.sessionId}:${request.requestId}`;
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(request))
      .digest("hex");
    const cached = this.requests.get(key);
    if (cached) {
      if (cached.fingerprint !== fingerprint)
        throw new EditingError(
          "REQUEST_REUSED",
          "This request ID was already used for a different operation.",
        );
      return structuredClone(cached.snapshot);
    }
    if (request.expectedRevision !== this.state.revision)
      throw new EditingError(
        "CONFLICT",
        "The project has changed. Read its latest revision and retry.",
      );
    const before = this.state.project;
    change();
    const snapshot = {
      ...this.state.snapshot(),
      changedItemIds: changedItemIds(before, this.state.project),
    };
    this.requests.set(key, {
      fingerprint,
      snapshot,
      bytes: Buffer.byteLength(JSON.stringify(snapshot)),
    });
    let bytes = [...this.requests.values()].reduce(
      (sum, entry) => sum + entry.bytes,
      0,
    );
    while (this.requests.size > 128 || bytes > 8 * 1024 * 1024) {
      const oldest = this.requests.keys().next().value!;
      bytes -= this.requests.get(oldest)!.bytes;
      this.requests.delete(oldest);
    }
    return structuredClone(snapshot);
  }

  private applyOperations(operations: EditOperation[], group?: string): void {
    // Reuse command semantics on an isolated owner; publish only the final batch.
    const draft = new AppState({ count: 0 }, this.state.project);
    for (const operation of operations) {
      const args = editSchemas[operation.command].parse(
        operation.args,
      ) as CommandArgs;
      const result = this.handlers[operation.command](args, {
        state: draft,
      });
      if (result instanceof Promise)
        throw new Error("Asynchronous commands cannot be batched");
    }
    this.state.executeProjectChange(
      (project) => Object.assign(project, draft.project),
      { group },
    );
  }
}
