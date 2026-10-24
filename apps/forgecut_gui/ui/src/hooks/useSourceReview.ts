import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { JobSnapshot } from "../../electron/shared/jobs";
import type { Result } from "../../electron/shared/result";
import type {
  SourceReview,
  SourceReviewRequest,
} from "../../electron/shared/source-review";
import { invoke } from "../lib/bridge";

const contactSheetSchema = z.object({
  assetId: z.string(),
  startUs: z.number(),
  endUs: z.number(),
  mimeType: z.literal("image/jpeg"),
  data: z.string().max(700000),
  columns: z.literal(4),
  rows: z.literal(3),
  timesUs: z.array(z.number()).length(12),
});
const waveformSchema = z.object({
  assetId: z.string(),
  startUs: z.number(),
  endUs: z.number(),
  sampleRate: z.literal(8000),
  samplesPerPeak: z.number().int().positive(),
  peaks: z
    .array(z.tuple([z.number().min(-1).max(1), z.number().min(-1).max(1)]))
    .min(1)
    .max(512),
});
const previewSchema = contactSheetSchema
  .omit({ columns: true, rows: true, timesUs: true })
  .extend({
    mimeType: z.literal("video/webm"),
    data: z.base64().min(1).max(700000),
  });
const sourceReviewSchema = z.union([
  contactSheetSchema,
  waveformSchema,
  previewSchema,
]);
const active = (job: JobSnapshot) =>
  !["completed", "failed", "cancelled"].includes(job.status);
function stop(job: JobSnapshot | null) {
  if (job && active(job))
    void invoke("cancel_media_job", {
      sessionId: job.sessionId,
      jobId: job.id,
    }).catch(() => {});
}

type Input = Omit<SourceReviewRequest, "kind" | "requestId">;
export function useSourceReview(input: Input) {
  const [result, setResult] = useState<Result<SourceReview> | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const job = useRef<JobSnapshot | null>(null);
  useEffect(() => {
    setResult(null);
    setStatus(null);
    setBusy(false);
    return () => {
      generation.current += 1;
      stop(job.current);
      job.current = null;
    };
  }, [input.sessionId, input.assetId, input.startUs, input.endUs]);
  async function start(kind: SourceReviewRequest["kind"]) {
    generation.current += 1;
    const token = generation.current;
    stop(job.current);
    job.current = null;
    setBusy(true);
    setResult(null);
    setStatus("queued");
    try {
      let current = await invoke("start_source_review", {
        ...input,
        kind,
        requestId: crypto.randomUUID(),
      });
      if (token !== generation.current) {
        stop(current);
        return;
      }
      job.current = current;
      while (active(current)) {
        setStatus(current.status);
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 100);
        });
        if (token !== generation.current) return;
        current = await invoke("get_media_job", {
          sessionId: current.sessionId,
          jobId: current.id,
        });
        if (token !== generation.current) return;
        job.current = current;
      }
      setStatus(current.status);
      if (!current.result) {
        setResult({
          ok: false,
          error: { code: "CANCELLED", message: "Source review cancelled" },
        });
      } else if (!current.result.ok) {
        setResult(current.result);
      } else {
        const parsed = sourceReviewSchema.safeParse(current.result.value);
        setResult(
          parsed.success
            ? { ok: true, value: parsed.data }
            : {
                ok: false,
                error: {
                  code: "IO_ERROR",
                  message: "Source review returned an unreadable result",
                },
              },
        );
      }
    } catch (cause) {
      if (token === generation.current)
        setResult({
          ok: false,
          error: {
            code: "IO_ERROR",
            message: cause instanceof Error ? cause.message : String(cause),
          },
        });
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  function clear(nextStatus: "cancelled" | null) {
    generation.current += 1;
    stop(job.current);
    job.current = null;
    setBusy(false);
    setStatus(nextStatus);
    setResult(null);
  }
  return {
    result,
    status,
    busy,
    start,
    cancel: () => clear("cancelled"),
    clear: () => clear(null),
  };
}
