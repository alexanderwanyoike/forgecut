import { useEffect, useRef, useState } from "react";
import type { GraphicPromotionRequest } from "../../electron/shared/graphic-promotion";
import type { JobSnapshot } from "../../electron/shared/jobs";
import type { Result } from "../../electron/shared/result";
import { invoke } from "../lib/bridge";

export function useSourcePromotionJob() {
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function start(
    request: GraphicPromotionRequest,
  ): Promise<Result<unknown>> {
    try {
      let current = await invoke("start_graphic_promotion", request);
      if (alive.current) setJob(current);
      while (!["completed", "failed", "cancelled"].includes(current.status)) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 100);
        });
        current = await invoke("get_media_job", {
          sessionId: current.sessionId,
          jobId: current.id,
        });
        if (alive.current) setJob(current);
      }
      return (
        current.result ?? {
          ok: false,
          error: {
            code: "IO_ERROR",
            message: "Apply completed without a result",
          },
        }
      );
    } catch (failure) {
      return {
        ok: false,
        error: {
          code: "IO_ERROR",
          message: failure instanceof Error ? failure.message : String(failure),
        },
      };
    }
  }
  async function cancel(): Promise<void> {
    if (!job) return;
    const current = await invoke("cancel_media_job", {
      sessionId: job.sessionId,
      jobId: job.id,
    });
    if (alive.current) setJob(current);
  }
  return {
    job,
    start,
    cancel,
    busy: !!job && !["completed", "failed", "cancelled"].includes(job.status),
  };
}
