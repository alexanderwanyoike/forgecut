import { ZodError } from "zod";
import { createHash } from "node:crypto";
import { creditCommands } from "./commands/credits.js";
import { stylePresetCommands } from "./commands/style-presets.js";
import { sourceSelectionCommands } from "./commands/source-selections.js";
import { sourceReviewCommands } from "./commands/source-review.js";
import { variantCommands } from "./commands/sequence-variants.js";
import { sequenceCommands } from "./commands/sequences.js";
import { graphicEditorCommands } from "./commands/graphic-editor.js";
import { graphicPromotionCommands } from "./commands/graphic-promotion.js";
import { GraphicDraftStore } from "./GraphicDraftStore.js";
import { graphicDraftCommands } from "./commands/graphic-drafts.js";
import { GraphicPreviewService } from "./GraphicPreviewService.js";
import { GraphicRenderCache } from "./GraphicRenderCache.js";
import { graphicPreviewCommands } from "./commands/graphic-preview.js";
import { changedItemIds } from "./project-diff.js";
import type {
  CommandName,
  CommandResponse,
  EditOperation,
  EditRequest,
  HistoryRequest,
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
import { ExportBatchService } from "./ExportBatchService.js";
import { exportBatchCommands } from "./commands/export-batches.js";
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
    | "create_export_batch"
    | "get_export_batch"
    | "resume_export_batch"
    | "cancel_export_batch"
    | "export_project"
    | "get_media_job"
    | "cancel_media_job"
  >,
  CommandHandler
> = {
  ...projectCommands,
  ...creditCommands,
  ...stylePresetCommands,
  ...sequenceCommands,
  ...variantCommands,
  ...sourceSelectionCommands,
  ...sourceReviewCommands,
  ...timelineCommands,
  ...graphicsCommands,
  ...graphicSourceCommands,
  ...graphicDraftCommands,
  ...graphicPromotionCommands,
  ...graphicEditorCommands,
  ...graphicPreviewCommands,
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

  readonly batches = new ExportBatchService(this.jobs);

  private readonly preview = new GraphicPreviewService();

  readonly renders = new GraphicRenderCache();

  private readonly drafts = new GraphicDraftStore();

  async closeGraphicsPreview(): Promise<void> {
    await Promise.all([this.preview.close(), this.renders.close()]);
  }

  private readonly handlers = {
    ...handlers,
    ...exportCommands(this.jobs),
    ...exportBatchCommands(this.batches),
  };

  private requests = new Map<string, CachedEdit>();

  constructor(readonly state: AppState) {
    let currentSessionId: string = state.sessionId;
    state.subscribe((snapshot) => {
      if (snapshot.sessionId !== currentSessionId) {
        currentSessionId = snapshot.sessionId;
        void this.preview.reset();
        this.renders.cancelPending();
      }
    });
  }

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
        command === "get_media_job" ||
        command === "cancel_media_job" ||
        command === "get_export_batch" ||
        command === "resume_export_batch" ||
        command === "cancel_export_batch";
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
            ? this.applyEdits({
                ...(args as EditRequest),
                sequenceId:
                  (args as EditRequest).sequenceId ?? meta?.sequenceId,
              })
            : this.applyHistory({
                ...(args as HistoryRequest),
                sequenceId:
                  (args as HistoryRequest).sequenceId ?? meta?.sequenceId,
              });
        return {
          ok: true,
          value: snapshot,
          sessionId: snapshot.sessionId,
          revision: snapshot.revision,
        };
      }
      if (command === "get_project_snapshot") value = this.state.snapshot();
      else if (Object.prototype.hasOwnProperty.call(editSchemas, command)) {
        value = this.applyOperations(
          [{ command, args } as EditOperation],
          meta?.editGroup,
          meta?.sequenceId,
        );
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
            | "create_export_batch"
            | "get_export_batch"
            | "resume_export_batch"
            | "cancel_export_batch"
            | "export_project"
            | "get_media_job"
            | "cancel_media_job"
        ](args, {
          state: this.state,
          sequenceId: meta?.sequenceId,
          preview: this.preview,
          renders: this.renders,
          drafts: this.drafts,
          jobs: this.jobs,
          ...options,
        });
        if (
          !jobControl &&
          command !== "export_project" &&
          command !== "collect_project" &&
          command !== "create_export_batch" &&
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
          error: {
            code: error.code,
            message: error.message,
            ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}),
          },
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
        request.sequenceId,
      ),
    );
  }

  private applyHistory(input: unknown): ProjectSnapshot {
    const request = historyRequestSchema.parse(input);
    return this.executeGuarded(request, () => {
      const target =
        request.direction === "undo"
          ? this.state.undoSequenceId
          : this.state.redoSequenceId;
      if (
        !request.sequenceId &&
        target &&
        (this.state.project.sequences?.length ?? 0) > 0
      )
        throw new EditingError(
          "INVALID_INPUT",
          "Provide a sequence ID for this history action",
        );
      if (request.direction === "undo") this.state.undo(request.sequenceId);
      else this.state.redo(request.sequenceId);
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

  private applyOperations(
    operations: EditOperation[],
    group?: string,
    sequenceId?: string,
  ): unknown {
    // Reuse command semantics on an isolated owner; publish only the final batch.
    const globalCommands = new Set<EditOperation["command"]>([
      "set_asset_license",
      "set_resource_license",
      "save_style_preset",
      "delete_style_preset",
      "update_source_selection",
      "save_source_selection",
      "delete_source_selection",
      "create_sequence_variant",
      "create_sequence",
      "rename_sequence",
      "delete_sequence",
      "remove_asset",
    ]);
    const targetsSequence = (operation: EditOperation) =>
      operation.command === "update_project"
        ? operation.args.settings !== undefined
        : !globalCommands.has(operation.command);
    const scoped = operations.some(targetsSequence);
    if (
      !sequenceId &&
      (this.state.project.sequences?.length ?? 0) > 0 &&
      scoped
    )
      throw new EditingError(
        "INVALID_INPUT",
        "Provide a sequence ID before editing a multi-sequence project",
      );
    const draft = new AppState({ count: 0 }, this.state.project);
    const targetId = sequenceId ?? this.state.activeSequence.id;
    draft.selectSequence(draft.sessionId, targetId);
    let value: unknown;
    for (const operation of operations) {
      if (targetsSequence(operation))
        draft.selectSequence(draft.sessionId, targetId);
      const args = editSchemas[operation.command].parse(
        operation.args,
      ) as CommandArgs;
      const result = this.handlers[operation.command](args, {
        state: draft,
      });
      if (result instanceof Promise)
        throw new Error("Asynchronous commands cannot be batched");
      value = result;
    }
    this.state.executeProjectChange(
      (project) => Object.assign(project, draft.project),
      { group, sequenceId: scoped ? targetId : undefined },
    );
    return value;
  }
}
