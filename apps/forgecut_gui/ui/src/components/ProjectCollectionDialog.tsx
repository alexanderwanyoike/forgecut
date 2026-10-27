import { FolderArchive, Plus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProjectSnapshot } from "../../electron/shared/ipc-contract";
import type { JobSnapshot } from "../../electron/shared/jobs";
import type { ProjectCollectionRequest } from "../../electron/shared/project-collection";
import type { Result } from "../../electron/shared/result";
import { invoke } from "../lib/bridge";
import ActionButton from "./ActionButton";
import CollectionForm from "./CollectionForm";
import "./project-collection-dialog.css";

const active = (job: JobSnapshot) =>
  ["queued", "running", "cancelling", "committing"].includes(job.status);
const labels: Record<JobSnapshot["status"], string> = {
  queued: "Queued",
  running: "Copying media",
  cancelling: "Cancelling",
  committing: "Finishing collection",
  completed: "Collection ready",
  failed: "Collection failed",
  cancelled: "Collection cancelled",
};
type CollectionRun = { job: JobSnapshot; directory: string; name: string };
async function requestJob(
  operation: () => Promise<JobSnapshot>,
): Promise<Result<JobSnapshot>> {
  try {
    return { ok: true, value: await operation() };
  } catch (cause) {
    return {
      ok: false,
      error: {
        code:
          cause instanceof Error &&
          "code" in cause &&
          typeof cause.code === "string"
            ? cause.code
            : "IO_ERROR",
        message: cause instanceof Error ? cause.message : String(cause),
      },
    };
  }
}

export default function ProjectCollectionDialog({
  open,
  snapshot,
  onClose,
}: {
  open: boolean;
  snapshot: ProjectSnapshot | null;
  onClose: () => void;
}) {
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const [run, setRun] = useState<CollectionRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open && dialog && !dialog.open) dialog.showModal();
  }, [dialog, open]);
  useEffect(() => {
    if (!run || !active(run.job) || busy) return undefined;
    let disposed = false;
    let pending = false;
    const { id, sessionId } = run.job;
    const poll = async () => {
      if (pending) return;
      pending = true;
      const result = await requestJob(() =>
        invoke("get_media_job", { sessionId, jobId: id }),
      );
      pending = false;
      if (disposed) return;
      if (result.ok) {
        setRun((current) =>
          current?.job.id === id ? { ...current, job: result.value } : current,
        );
        setError(null);
      } else setError(result.error.message);
    };
    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 250);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [run?.job.id, run?.job.status, busy]);
  async function collect(request: ProjectCollectionRequest, name: string) {
    setBusy(true);
    setError(null);
    const result = await requestJob(() => invoke("collect_project", request));
    if (result.ok)
      setRun({ job: result.value, directory: request.directory, name });
    else setError(result.error.message);
    setBusy(false);
  }
  async function cancel() {
    if (!run) return;
    setBusy(true);
    setError(null);
    const result = await requestJob(() =>
      invoke("cancel_media_job", {
        sessionId: run.job.sessionId,
        jobId: run.job.id,
      }),
    );
    if (result.ok)
      setRun((current) =>
        current ? { ...current, job: result.value } : current,
      );
    else setError(result.error.message);
    setBusy(false);
  }
  if (!open) return null;
  const failure =
    error ??
    (run?.job.result && !run.job.result.ok
      ? run.job.result.error.message
      : null);
  return (
    <dialog
      ref={setDialog}
      className="collection-dialog"
      aria-labelledby="collection-heading"
      onCancel={onClose}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="collection-header">
        <div>
          <FolderArchive size={20} aria-hidden="true" />
          <h2 id="collection-heading">Collect project</h2>
        </div>
        <ActionButton
          icon={X}
          iconOnly
          tooltip="Close project collection"
          tooltipContainer={dialog}
          onClick={onClose}
        />
      </header>
      {run ? (
        <>
          <div className="collection-body">
            <div className="collection-summary">
              <strong>{run.name}</strong>
              <span role="status">{labels[run.job.status]}</span>
            </div>
            <p className="collection-folder">{run.directory}</p>
            <progress
              aria-label="Collection progress"
              max={1}
              value={run.job.progress}
            />
            {active(run.job) && (
              <p className="collection-note">
                You can close this window and keep editing. The captured project
                continues collecting.
              </p>
            )}
            {run.job.status === "completed" && (
              <p className="collection-note">
                Open <strong>project.forgecut</strong> in this folder when you
                are ready. Your current project is unchanged.
              </p>
            )}
            {failure && (
              <p className="collection-error" role="alert">
                {failure}
              </p>
            )}
          </div>
          <footer className="collection-footer">
            {active(run.job) ? (
              <ActionButton
                icon={Square}
                disabled={
                  busy ||
                  run.job.status === "committing" ||
                  run.job.status === "cancelling"
                }
                onClick={cancel}
              >
                Cancel collection
              </ActionButton>
            ) : (
              <ActionButton
                icon={Plus}
                onClick={() => {
                  setRun(null);
                  setError(null);
                }}
              >
                New collection
              </ActionButton>
            )}
          </footer>
        </>
      ) : (
        <>
          <CollectionForm
            snapshot={snapshot}
            failure={failure}
            busy={busy}
            dialog={dialog}
            onCollect={collect}
          />
        </>
      )}
    </dialog>
  );
}
