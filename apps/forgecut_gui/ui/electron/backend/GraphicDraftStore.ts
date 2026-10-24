import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { lock } from "proper-lockfile";
import type { GraphicDraft } from "../shared/graphic-draft.js";
import type { GraphicComponent } from "../shared/graphics.js";
import type { Result } from "../shared/result.js";
import { atomicWrite } from "./atomic-file.js";
import { graphicDraftSchema } from "./graphic-draft-schema.js";

type DraftResult = Result<
  GraphicDraft,
  {
    code:
      | "IO_ERROR"
      | "CONFLICT"
      | "INVALID_INPUT"
      | "PROJECT_CHANGED"
      | "CANCELLED";
    message: string;
  }
>;

export class GraphicDraftStore {
  private pending: Promise<unknown> = Promise.resolve();

  private readonly directory =
    process.env.FORGECUT_DRAFT_DIR ?? join(homedir(), ".forgecut", "drafts");

  async read(initial: GraphicDraft): Promise<DraftResult> {
    await this.pending;
    return this.load(initial);
  }

  commit(
    initial: GraphicDraft,
    expectedRevision: number,
    publish: () => Result<
      void,
      { code: "CONFLICT" | "PROJECT_CHANGED" | "CANCELLED"; message: string }
    >,
  ): Promise<DraftResult> {
    const operation = this.pending.then(() =>
      this.locked(initial, async () => {
        const current = await this.load(initial);
        if (!current.ok) return current;
        if (current.value.revision !== expectedRevision)
          return {
            ok: false as const,
            error: {
              code: "CONFLICT" as const,
              message: "The source draft changed during validation",
            },
          };
        const published = publish();
        return published.ok ? current : published;
      }),
    );
    this.pending = operation;
    return operation;
  }

  save(
    initial: GraphicDraft,
    expectedRevision: number,
    component: GraphicComponent,
    baseVersion: string,
  ): Promise<DraftResult> {
    const operation = this.pending.then(() =>
      this.locked(initial, async (): Promise<DraftResult> => {
        const current = await this.load(initial);
        if (!current.ok) return current;
        if (current.value.revision !== expectedRevision)
          return {
            ok: false,
            error: {
              code: "CONFLICT",
              message:
                "The source draft changed. Keep your buffer and reload or reconcile the latest draft.",
            },
          };
        try {
          const draft = graphicDraftSchema.parse({
            ...initial,
            revision: expectedRevision + 1,
            component,
            baseVersion,
          });
          const data = JSON.stringify(draft);
          if (Buffer.byteLength(data) > 4 * 1024 * 1024)
            return {
              ok: false,
              error: {
                code: "INVALID_INPUT",
                message: "The source draft exceeds 4 MiB",
              },
            };
          await atomicWrite(this.path(draft), data);
          return { ok: true, value: draft };
        } catch (failure) {
          return {
            ok: false,
            error: {
              code: "IO_ERROR",
              message:
                failure instanceof Error ? failure.message : String(failure),
            },
          };
        }
      }),
    );
    this.pending = operation;
    return operation;
  }

  private async locked(
    initial: GraphicDraft,
    operation: () => Promise<DraftResult>,
  ): Promise<DraftResult> {
    let release: (() => Promise<void>) | undefined;
    let outcome: DraftResult;
    let compromised: Error | undefined;
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      release = await lock(this.path(initial), {
        realpath: false,
        stale: 10000,
        update: 5000,
        onCompromised: (error) => {
          compromised = error;
        },
      });
      outcome = await operation();
      if (compromised) throw compromised;
    } catch (failure) {
      const contention = (failure as NodeJS.ErrnoException).code === "ELOCKED";
      const message =
        failure instanceof Error ? failure.message : String(failure);
      outcome = {
        ok: false,
        error: {
          code: contention ? "CONFLICT" : "IO_ERROR",
          message: contention
            ? "Another editor is saving this draft. Reload its latest revision before retrying."
            : message,
        },
      };
    }
    if (release) {
      try {
        await release();
      } catch (failure) {
        const cleanup = `Draft lock cleanup failed: ${failure instanceof Error ? failure.message : String(failure)}`;
        outcome = {
          ok: false,
          error: outcome.ok
            ? { code: "IO_ERROR", message: cleanup }
            : {
                ...outcome.error,
                message: `${outcome.error.message}; ${cleanup}`,
              },
        };
      }
    }
    return outcome;
  }

  private path(draft: GraphicDraft): string {
    const identity = graphicDraftSchema
      .pick({ projectId: true, itemId: true })
      .parse({ projectId: draft.projectId, itemId: draft.itemId });
    return join(
      this.directory,
      `${identity.projectId}-${identity.itemId}.json`,
    );
  }

  private async load(initial: GraphicDraft): Promise<DraftResult> {
    try {
      const file = await open(this.path(initial), "r");
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 4 * 1024 * 1024)
          return {
            ok: false,
            error: {
              code: "INVALID_INPUT",
              message: "The stored source draft is invalid or too large",
            },
          };
        const draft = graphicDraftSchema.parse(
          JSON.parse(await file.readFile("utf8")),
        );
        if (
          draft.projectId !== initial.projectId ||
          draft.itemId !== initial.itemId
        )
          return {
            ok: false,
            error: {
              code: "INVALID_INPUT",
              message: "The stored draft belongs to a different graphic",
            },
          };
        return { ok: true, value: draft };
      } finally {
        await file.close();
      }
    } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code === "ENOENT")
        return { ok: true, value: structuredClone(initial) };
      return {
        ok: false,
        error: {
          code: "IO_ERROR",
          message: failure instanceof Error ? failure.message : String(failure),
        },
      };
    }
  }
}
