import { useState } from "react";
import { projectSequences } from "../../electron/domain/project-sequences";
import type {
  ProjectSnapshot,
  ProjectSettings,
} from "../../electron/shared/ipc-contract";
import { invoke } from "../lib/bridge";
import "./sequence-controls.css";

type Props = {
  snapshot: ProjectSnapshot;
  beforeChange: () => Promise<boolean>;
};

export default function SequenceControls({ snapshot, beforeChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState<{
    name: string;
    settings: ProjectSettings;
  } | null>(null);
  const sequences = projectSequences(snapshot.project);
  const active = snapshot.activeSequenceId ?? sequences[0].id;
  const selected =
    sequences.find((sequence) => sequence.id === active) ?? sequences[0];
  async function select(sequenceId: string) {
    setBusy(true);
    try {
      if (!(await beforeChange())) return;
      await invoke("select_sequence", {
        sessionId: snapshot.sessionId,
        sequenceId,
      });
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (!creating || busy) return;
    setBusy(true);
    try {
      if (!(await beforeChange())) return;
      const current = await invoke("get_project_snapshot");
      if (current.sessionId !== snapshot.sessionId) return;
      const sequence = await invoke("create_sequence", creating);
      await invoke("select_sequence", {
        sessionId: snapshot.sessionId,
        sequenceId: sequence.id,
      });
      setCreating(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sequence-controls">
      <label>
        <span>Sequence</span>
        <select
          aria-label="Active sequence"
          disabled={busy || creating !== null}
          value={active}
          onChange={(event) => {
            void select(event.currentTarget.value).catch(() => {});
          }}
        >
          {sequences.map((sequence) => (
            <option key={sequence.id} value={sequence.id}>
              {sequence.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="sequence-action"
        disabled={busy || creating !== null}
        onClick={() =>
          setCreating({ name: "", settings: { ...selected.settings } })
        }
      >
        New sequence
      </button>
      {creating && (
        <form
          className="sequence-name-form"
          onSubmit={(event) => {
            event.preventDefault();
            void create().catch(() => {});
          }}
        >
          <label>
            Sequence name
            <input
              aria-label="Sequence name"
              maxLength={200}
              autoFocus
              disabled={busy}
              value={creating.name}
              onChange={(event) => {
                const name = event.currentTarget.value;
                setCreating((current) =>
                  current ? { ...current, name } : null,
                );
              }}
            />
          </label>
          <div className="sequence-form-actions">
            <button
              type="submit"
              className="sequence-action"
              disabled={busy || !creating.name.trim()}
            >
              Create sequence
            </button>
            <button
              type="button"
              className="sequence-action"
              disabled={busy}
              onClick={() => setCreating(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
