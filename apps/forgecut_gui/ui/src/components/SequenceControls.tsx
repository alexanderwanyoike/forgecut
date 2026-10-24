import { useState } from "react";
import { projectSequences } from "../../electron/domain/project-sequences";
import type { ProjectSnapshot } from "../../electron/shared/ipc-contract";
import { invoke } from "../lib/bridge";
import "./sequence-controls.css";

type Props = {
  snapshot: ProjectSnapshot;
  beforeChange: () => Promise<boolean>;
};

export default function SequenceControls({ snapshot, beforeChange }: Props) {
  const [busy, setBusy] = useState(false);
  const sequences = projectSequences(snapshot.project);
  const active = snapshot.activeSequenceId ?? sequences[0].id;
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
  return (
    <label className="sequence-controls">
      <span>Sequence</span>
      <select
        aria-label="Active sequence"
        disabled={busy}
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
  );
}
