import { useState, useEffect } from "react";
import type { JobSnapshot } from "../../electron/shared/jobs";
import { invoke, save } from "../lib/bridge";

const active = (job: JobSnapshot | null) =>
  !!job &&
  ["queued", "running", "cancelling", "committing"].includes(job.status);

function acceptJob(
  current: JobSnapshot | null,
  next: JobSnapshot,
): JobSnapshot {
  if (current?.id !== next.id) return next;
  if (
    !active(current) ||
    (current.status === "committing" && active(next)) ||
    (current.status === "cancelling" &&
      ["queued", "running"].includes(next.status))
  )
    return current;
  return { ...next, progress: Math.max(current.progress, next.progress) };
}

export default function ExportDialog(props: {
  onClose: () => void;
  open: boolean;
}) {
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exporting = active(job);
  useEffect(() => {
    if (!job || !active(job)) return undefined;
    let disposed = false;
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await invoke("get_media_job", {
          sessionId: job.sessionId,
          jobId: job.id,
        });
        if (!disposed) {
          setJob((current) => acceptJob(current, next));
          setError(null);
        }
      } catch (cause) {
        if (!disposed) {
          const code = cause instanceof Error && "code" in cause ? cause.code : null;
          if (code === "CONFLICT" || code === "PROJECT_CHANGED") return;
          setError(String(cause));
          if (code === "NOT_FOUND") setJob(null);
        }
      } finally {
        pending = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 250);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [job?.id, job?.status]);

  const handleExport = async () => {
    setStarting(true);
    setError(null);
    setJob(null);
    try {
      const outputPath = await save({
        filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
        defaultPath: "export.mp4",
      });
      if (outputPath) setJob(await invoke("export_project", { outputPath }));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setStarting(false);
    }
  };
  const cancel = async () => {
    if (!job) return;
    try {
      const next = await invoke("cancel_media_job", {
        sessionId: job.sessionId,
        jobId: job.id,
      });
      setJob((current) => acceptJob(current, next));
    } catch (cause) {
      setError(String(cause));
    }
  };
  if (!props.open) return null;
  const failed =
    job?.status === "failed" && job.result && !job.result.ok
      ? job.result.error.message
      : null;
  let statusLabel = "Rendering";
  if (job?.status === "queued") statusLabel = "Queued";
  if (job?.status === "cancelling") statusLabel = "Cancelling";
  if (job?.status === "committing") statusLabel = "Finishing";
  return (
    <div
      className="export-dialog-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-heading"
      >
        <div className="export-header">
          <h3 id="export-heading">Export project</h3>
          <button
            className="close-btn"
            aria-label="Close export dialog"
            onClick={props.onClose}
          >
            &times;
          </button>
        </div>
        <div className="export-body">
          <div className="export-info">
            <div className="info-row">
              <span>Format</span>
              <span>MP4 / H.264 + AAC</span>
            </div>
            <div className="info-row">
              <span>Quality</span>
              <span>CRF 23</span>
            </div>
            {job && (
              <div className="info-row">
                <span>Project revision</span>
                <span>{job.projectRevision}</span>
              </div>
            )}
          </div>
          {exporting && job && (
            <div className="export-progress" aria-live="polite">
              <div
                className="progress-bar"
                role="progressbar"
                aria-label="Export progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(job.progress * 100)}
              >
                <div
                  className="progress-fill"
                  style={{ width: `${job.progress * 100}%` }}
                />
              </div>
              <div className="progress-stats">
                <span>{statusLabel}</span>
                <span>{(job.progress * 100).toFixed(1)}%</span>
              </div>
              <p>You can return to the editor while this export runs.</p>
            </div>
          )}
          {(error || failed) && (
            <div className="export-error" role="alert">
              {error || failed}
            </div>
          )}
          {job?.status === "completed" && (
            <div className="export-success" role="status">
              Export complete
            </div>
          )}
          {job?.status === "cancelled" && (
            <div role="status">Export cancelled</div>
          )}
        </div>
        <div className="export-footer">
          {exporting && (
            <button
              className="preview-btn"
              disabled={
                job?.status === "cancelling" || job?.status === "committing"
              }
              onClick={cancel}
            >
              Cancel export
            </button>
          )}
          {exporting && (
            <button className="btn-export" onClick={props.onClose}>
              Back to editor
            </button>
          )}
          {!exporting && (
            <button
              className="btn-export"
              disabled={starting}
              onClick={handleExport}
            >
              {starting ? "Preparing" : "Export"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
