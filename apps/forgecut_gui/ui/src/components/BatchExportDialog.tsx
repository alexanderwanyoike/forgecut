import {
  Check,
  FolderOpen,
  ListVideo,
  Pause,
  Play,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ProjectSnapshot } from "../../electron/shared/ipc-contract";
import {
  EXPORT_PRESETS,
  EXPORT_PRESET_IDS,
  type ExportPresetId,
} from "../../electron/shared/export-presets";
import { projectSequences } from "../../electron/domain/project-sequences";
import { useExportBatch } from "../hooks/useExportBatch";
import { open, save } from "../lib/bridge";
import ActionButton from "./ActionButton";
import "./batch-export-dialog.css";

const status = {
  pending: "Waiting",
  queued: "Queued",
  running: "Rendering",
  completed: "Complete",
  failed: "Failed",
  cancelled: "Paused",
  interrupted: "Interrupted",
};
export default function BatchExportDialog({
  snapshot,
  initialDirectory,
  remember,
  onClose,
}: {
  snapshot: ProjectSnapshot | null;
  initialDirectory: string | null;
  remember: (directory: string) => void;
  onClose: () => void;
}) {
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const [captured, setCaptured] = useState(snapshot);
  const sequences = captured ? projectSequences(captured.project) : [];
  const [selected, setSelected] = useState(() =>
    sequences.map((sequence) => sequence.id),
  );
  const [preset, setPreset] = useState<ExportPresetId>("mp4");
  const [directory, setDirectory] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const manager = useExportBatch(initialDirectory, remember);
  const { batch, busy, error } = manager;
  const disabled = busy || choosing;
  const stale =
    captured?.sessionId !== snapshot?.sessionId ||
    captured?.revision !== snapshot?.revision;
  const unfinished =
    batch?.entries.some((entry) => entry.status !== "completed") ?? false;
  const retry =
    batch?.entries.some(
      (entry) => !["completed", "pending"].includes(entry.status),
    ) ?? false;
  useEffect(() => {
    if (dialog && !dialog.open) dialog.showModal();
  }, [dialog]);
  async function choose(existing: boolean) {
    setChoosing(true);
    setPickerError(null);
    try {
      if (existing) {
        const path = await open<string>({
          properties: ["openDirectory"],
          title: "Open export batch folder",
        });
        if (path) await manager.load(path);
      } else {
        const path = await save({
          title: "Choose a new export batch folder",
          buttonLabel: "Choose location",
          defaultPath: "Exports",
        });
        if (path) setDirectory(path);
      }
    } catch (cause) {
      setPickerError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setChoosing(false);
    }
  }
  async function create() {
    if (!captured || stale || !selected.length || !directory.trim()) return;
    const saved = await manager.create({
      sessionId: captured.sessionId,
      expectedRevision: captured.revision,
      directory: directory.trim(),
      sequenceIds: selected,
      preset,
    });
    if (saved.ok) await manager.resume(saved.value);
  }
  function refresh() {
    setCaptured(snapshot);
    const ids = snapshot
      ? projectSequences(snapshot.project).map((sequence) => sequence.id)
      : [];
    setSelected((current) =>
      captured?.sessionId === snapshot?.sessionId
        ? current.filter((id) => ids.includes(id))
        : ids,
    );
  }
  return (
    <dialog
      ref={setDialog}
      className="batch-dialog"
      aria-labelledby="batch-heading"
      onCancel={onClose}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="batch-header">
        <div>
          <ListVideo size={20} aria-hidden="true" />
          <h2 id="batch-heading">Batch exports</h2>
        </div>
        <ActionButton
          icon={X}
          iconOnly
          tooltip="Close batch exports"
          tooltipContainer={dialog}
          onClick={onClose}
        />
      </header>
      <div className="batch-body">
        <p className="batch-intro">
          Export your sequences one at a time. Saved batches can be resumed
          after a restart.
        </p>
        {batch ? (
          <>
            <div className="batch-summary">
              <strong>{batch.projectName}</strong>
              <span>
                {
                  batch.entries.filter((entry) => entry.status === "completed")
                    .length
                }{" "}
                / {batch.entries.length} complete
              </span>
            </div>
            <p className="batch-folder" title={batch.directory}>
              {batch.directory}
            </p>
            <progress
              className="batch-progress"
              aria-label="Batch export progress"
              max={1}
              value={batch.progress}
            />
            <ul className="batch-entries">
              {batch.entries.map((entry) => (
                <li key={entry.id}>
                  <span className="batch-entry-icon" aria-hidden="true">
                    {entry.status === "completed" ? (
                      <Check size={16} />
                    ) : (
                      <ListVideo size={16} />
                    )}
                  </span>
                  <div>
                    <strong title={entry.name}>{entry.name}</strong>
                    <small>{EXPORT_PRESETS[entry.preset].label}</small>
                    {entry.error && (
                      <p className="batch-entry-error">{entry.error}</p>
                    )}
                  </div>
                  <span className="batch-status">{status[entry.status]}</span>
                </li>
              ))}
            </ul>
            {retry && !batch.active && (
              <p className="batch-note">
                Completed exports are kept. Unfinished outputs restart from the
                beginning and may replace that entry’s previous file.
              </p>
            )}
            {batch.active && (
              <p className="batch-note">
                You can close this window and keep editing. Pausing lets the
                current file finish saving if needed.
              </p>
            )}
          </>
        ) : (
          <>
            {stale && (
              <div className="batch-refresh">
                <p>
                  The project changed. Refresh the sequence list before creating
                  a batch.
                </p>
                <ActionButton
                  icon={RefreshCw}
                  onClick={refresh}
                  disabled={disabled}
                >
                  Refresh sequences
                </ActionButton>
              </div>
            )}
            <fieldset className="batch-selection" disabled={disabled || stale}>
              <legend>Sequences</legend>
              {sequences.map((sequence) => (
                <label key={sequence.id}>
                  <input
                    type="checkbox"
                    aria-label={`Export ${sequence.name}`}
                    checked={selected.includes(sequence.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, sequence.id]
                          : current.filter((id) => id !== sequence.id),
                      )
                    }
                  />
                  <span title={sequence.name}>{sequence.name}</span>
                  <small>
                    {sequence.settings.width} × {sequence.settings.height}
                  </small>
                </label>
              ))}
              {!sequences.length && <p>Open a project to choose sequences.</p>}
            </fieldset>
            <label className="batch-field">
              Batch format
              <select
                value={preset}
                disabled={disabled}
                onChange={(event) => {
                  const { value } = event.target;
                  if (value === "mp4" || value === "webm") setPreset(value);
                }}
              >
                {EXPORT_PRESET_IDS.map((id) => (
                  <option key={id} value={id}>
                    {EXPORT_PRESETS[id].label}
                  </option>
                ))}
              </select>
            </label>
            <div className="batch-location">
              <label className="batch-field">
                Batch folder
                <input
                  value={directory}
                  disabled={disabled}
                  placeholder="Choose a new folder"
                  onChange={(event) => setDirectory(event.target.value)}
                />
              </label>
              <ActionButton
                icon={FolderOpen}
                tooltip="Choose a location for a new batch folder"
                tooltipContainer={dialog}
                disabled={disabled}
                onClick={() => choose(false)}
              >
                Browse
              </ActionButton>
            </div>
          </>
        )}
        {(error || pickerError) && (
          <p className="batch-error" role="alert">
            {error || pickerError}
          </p>
        )}
      </div>
      <footer className="batch-footer">
        <ActionButton
          icon={FolderOpen}
          disabled={disabled || !!batch?.active}
          tooltip="Read a saved batch without starting exports"
          tooltipContainer={dialog}
          onClick={() => choose(true)}
        >
          Open saved batch
        </ActionButton>
        {batch ? (
          <>
            {batch.active ? (
              <ActionButton
                icon={Pause}
                disabled={disabled}
                onClick={() => manager.pause(batch)}
              >
                Pause batch
              </ActionButton>
            ) : (
              <>
                <ActionButton
                  icon={Plus}
                  disabled={disabled}
                  onClick={() => {
                    manager.clear();
                    setDirectory("");
                    setCaptured(snapshot);
                    setSelected(
                      snapshot
                        ? projectSequences(snapshot.project).map(
                            (sequence) => sequence.id,
                          )
                        : [],
                    );
                  }}
                >
                  New batch
                </ActionButton>
                {unfinished && (
                  <ActionButton
                    icon={Play}
                    className="primary-action"
                    disabled={disabled}
                    onClick={() => manager.resume(batch, retry)}
                  >
                    {retry ? "Retry unfinished exports" : "Resume batch"}
                  </ActionButton>
                )}
              </>
            )}
          </>
        ) : (
          <ActionButton
            icon={Play}
            className="primary-action"
            disabled={
              disabled ||
              stale ||
              !captured ||
              !selected.length ||
              !directory.trim()
            }
            onClick={create}
          >
            Create and export
          </ActionButton>
        )}
      </footer>
    </dialog>
  );
}
