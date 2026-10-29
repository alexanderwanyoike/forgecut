import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CreateExportBatch,
  ExportBatchSnapshot,
} from "../../electron/shared/export-batches";
import type { Result } from "../../electron/shared/result";
import { invoke } from "../lib/bridge";

function failure(cause: unknown) {
  const code =
    cause instanceof Error && "code" in cause && typeof cause.code === "string"
      ? cause.code
      : "IO_ERROR";
  return {
    code,
    message: cause instanceof Error ? cause.message : String(cause),
  };
}

export function useExportBatch(
  initialDirectory: string | null,
  remember: (directory: string) => void,
) {
  const initial = useRef(initialDirectory);
  const generation = useRef(0);
  const mounted = useRef(true);
  const [batch, setBatch] = useState<ExportBatchSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (
      operation: () => Promise<ExportBatchSnapshot>,
    ): Promise<Result<ExportBatchSnapshot>> => {
      generation.current += 1;
      const { current } = generation;
      if (mounted.current) {
        setBusy(true);
        setError(null);
      }
      try {
        const value = await operation();
        if (mounted.current && current === generation.current) setBatch(value);
        // View cleanup cannot cancel the accepted create-then-resume workflow.
        remember(value.directory);
        return { ok: true, value };
      } catch (cause) {
        const reason = failure(cause);
        if (mounted.current && current === generation.current)
          setError(reason.message);
        return { ok: false, error: reason };
      } finally {
        if (mounted.current && current === generation.current) setBusy(false);
      }
    },
    [remember],
  );
  const load = useCallback(
    (directory: string) => run(() => invoke("get_export_batch", { directory })),
    [run],
  );
  useEffect(() => {
    mounted.current = true;
    if (initial.current) void load(initial.current);
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [load]);
  useEffect(() => {
    if (!batch?.active) return undefined;
    let disposed = false;
    let pending = false;
    const { directory, id } = batch;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await invoke("get_export_batch", { directory });
        if (!disposed)
          setBatch((current) =>
            current?.id === id && current.directory === directory
              ? next
              : current,
          );
      } catch (cause) {
        if (!disposed) {
          setError(failure(cause).message);
          setBatch((current) =>
            current?.id === id && current.directory === directory
              ? { ...current, active: false }
              : current,
          );
        }
      } finally {
        pending = false;
      }
    };
    const timer = window.setInterval(() => {
      void poll();
    }, 250);
    void poll();
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [batch?.directory, batch?.id, batch?.active]);
  return {
    batch,
    busy,
    error,
    load,
    create: (request: CreateExportBatch) =>
      run(() => invoke("create_export_batch", request)),
    resume: (target: ExportBatchSnapshot, retryInterrupted = false) =>
      run(() =>
        invoke("resume_export_batch", {
          directory: target.directory,
          batchId: target.id,
          ...(retryInterrupted ? { retryInterrupted: true } : {}),
        }),
      ),
    pause: (target: ExportBatchSnapshot) =>
      run(() =>
        invoke("cancel_export_batch", {
          directory: target.directory,
          batchId: target.id,
        }),
      ),
    clear: () => {
      generation.current += 1;
      setBatch(null);
      setError(null);
      setBusy(false);
    },
  };
}
