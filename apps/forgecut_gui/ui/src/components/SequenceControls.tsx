import { useState } from "react";
import { projectSequences } from "../../electron/domain/project-sequences";
import type {
  ProjectSnapshot,
  ProjectSettings,
} from "../../electron/shared/ipc-contract";
import { invoke } from "../lib/bridge";
import "./sequence-controls.css";

type NameEdit =
  | { kind: "create"; name: string; settings: ProjectSettings }
  | { kind: "rename"; name: string; sequenceId: string };

type Props = {
  snapshot: ProjectSnapshot;
  beforeChange: () => Promise<boolean>;
};

export default function SequenceControls({ snapshot, beforeChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<NameEdit | null>(null);
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
  async function save() {
    if (!form || busy) return;
    setBusy(true);
    try {
      if (form.kind === "rename") {
        await invoke("rename_sequence", {
          sequenceId: form.sequenceId,
          name: form.name,
        });
      } else {
        if (!(await canChangeProject())) return;
        const sequence = await invoke("create_sequence", {
          name: form.name,
          settings: form.settings,
        });
        await invoke("select_sequence", {
          sessionId: snapshot.sessionId,
          sequenceId: sequence.id,
        });
      }
      setForm(null);
    } finally {
      setBusy(false);
    }
  }
  async function canChangeProject(): Promise<boolean> {
    if (!(await beforeChange())) return false;
    return (
      (await invoke("get_project_snapshot")).sessionId === snapshot.sessionId
    );
  }
  async function remove() {
    if (busy) return;
    const sequenceId = selected.id;
    setBusy(true);
    try {
      if (await canChangeProject())
        await invoke("delete_sequence", { sequenceId });
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
          disabled={busy || form !== null}
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
        disabled={busy || form !== null}
        onClick={() =>
          setForm({
            kind: "create",
            name: "",
            settings: { ...selected.settings },
          })
        }
      >
        New sequence
      </button>
      <button
        className="sequence-action"
        disabled={busy || form !== null}
        onClick={() =>
          setForm({
            kind: "rename",
            name: selected.name,
            sequenceId: selected.id,
          })
        }
      >
        Rename sequence
      </button>
      <button
        className="sequence-action"
        disabled={busy || form !== null || selected.id === sequences[0].id}
        onClick={() => {
          void remove().catch(() => {});
        }}
      >
        Delete sequence
      </button>
      {form && (
        <form
          className="sequence-name-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save().catch(() => {});
          }}
        >
          <label>
            Sequence name
            <input
              aria-label="Sequence name"
              maxLength={200}
              autoFocus
              disabled={busy}
              value={form.name}
              onChange={(event) => {
                const name = event.currentTarget.value;
                setForm((current) => (current ? { ...current, name } : null));
              }}
            />
          </label>
          <div className="sequence-form-actions">
            <button
              type="submit"
              className="sequence-action"
              disabled={busy || !form.name.trim()}
            >
              {form.kind === "create"
                ? "Create sequence"
                : "Save sequence name"}
            </button>
            <button
              type="button"
              className="sequence-action"
              disabled={busy}
              onClick={() => setForm(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
