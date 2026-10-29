import { Copy, Layers3, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import ActionButton from "./ActionButton";
import SequenceNameForm, {
  variantSizes,
  type NameEdit,
} from "./SequenceNameForm";
import { projectSequences } from "../../electron/domain/project-sequences";
import type { ProjectSnapshot } from "../../electron/shared/ipc-contract";
import { invoke, invokeInContext } from "../lib/bridge";
import "./sequence-controls.css";

type Props = {
  snapshot: ProjectSnapshot;
  beforeChange: () => Promise<boolean>;
  selectedItemId: string | null;
};

export default function SequenceControls({
  snapshot,
  beforeChange,
  selectedItemId,
}: Props) {
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
        const sequence =
          form.kind === "variant"
            ? await invokeInContext(
                {
                  sessionId: snapshot.sessionId,
                  sequenceId: form.sourceSequenceId,
                },
                "create_sequence_variant",
                {
                  sourceSequenceId: form.sourceSequenceId,
                  name: form.name,
                  ...(form.format === "source"
                    ? {}
                    : { settings: variantSizes[form.format] }),
                },
              )
            : await invoke("create_sequence", {
                name: form.name,
                settings: form.settings,
              });
        await invokeInContext(
          { sessionId: snapshot.sessionId, sequenceId: sequence.id },
          "select_sequence",
          {
            sessionId: snapshot.sessionId,
            sequenceId: sequence.id,
          },
        );
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
        <Layers3 size={15} aria-hidden="true" />
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
      <ActionButton
        icon={Plus}
        tooltip="Create a sequence"
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
      </ActionButton>
      <ActionButton
        icon={Copy}
        iconOnly
        tooltip="Create sequence variant"
        disabled={busy || form !== null}
        onClick={() =>
          setForm({
            kind: "variant",
            name: `${selected.name.slice(0, 192)} variant`,
            sourceSequenceId: selected.id,
            sourceName: selected.name,
            format:
              selected.settings.width >= selected.settings.height
                ? "portrait"
                : "landscape",
          })
        }
      />
      <ActionButton
        icon={Pencil}
        iconOnly
        tooltip="Rename sequence"
        disabled={busy || form !== null}
        onClick={() =>
          setForm({
            kind: "rename",
            name: selected.name,
            sequenceId: selected.id,
          })
        }
      />
      <ActionButton
        icon={Trash2}
        iconOnly
        tooltip="Delete sequence"
        disabled={busy || form !== null || selected.id === sequences[0].id}
        onClick={() => {
          void remove().catch(() => {});
        }}
      />
      {selected.variant_source && (
        <ActionButton
          icon={RefreshCw}
          tooltip="Copy selected item timing from the source sequence, keeping local content and crop"
          disabled={busy || form !== null || !selectedItemId}
          onClick={() => {
            if (!selectedItemId) return;
            setBusy(true);
            void invokeInContext(
              { sessionId: snapshot.sessionId, sequenceId: selected.id },
              "sync_variant_timing",
              { itemIds: [selectedItemId] },
            )
              .catch(() => {})
              .finally(() => setBusy(false));
          }}
        >
          Sync timing
        </ActionButton>
      )}
      {form && (
        <SequenceNameForm
          form={form}
          busy={busy}
          onChange={setForm}
          onSubmit={() => {
            void save().catch(() => {});
          }}
          onCancel={() => setForm(null)}
        />
      )}
    </div>
  );
}
