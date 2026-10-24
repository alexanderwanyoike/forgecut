import { FileBadge, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProjectSnapshot } from "../../electron/shared/ipc-contract";
import ActionButton from "./ActionButton";
import CreditForm from "./CreditForm";
import "./credits-dialog.css";

export default function CreditsDialog({
  snapshot,
  onClose,
}: {
  snapshot: ProjectSnapshot;
  onClose: () => void;
}) {
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const entries = [
    ...snapshot.project.assets.map((value) => ({
      id: value.id,
      name: value.name,
      kind: value.kind,
      license: value.license,
      type: "asset" as const,
    })),
    ...(snapshot.project.resources ?? []).map((value) => ({
      id: value.id,
      name: value.name,
      kind: value.kind,
      license: value.license,
      type: "resource" as const,
    })),
  ];
  const [selected, setSelected] = useState<
    (typeof entries)[number] | undefined
  >(entries[0]);
  const target = entries.find((value) => value.id === selected?.id);
  useEffect(() => {
    if (dialog && !dialog.open) dialog.showModal();
  }, [dialog]);
  return (
    <dialog
      ref={setDialog}
      className="credits-dialog"
      aria-labelledby="credits-heading"
      onCancel={onClose}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="credits-header">
        <div>
          <FileBadge size={20} aria-hidden="true" />
          <h2 id="credits-heading">Project credits</h2>
        </div>
        <ActionButton
          icon={X}
          iconOnly
          tooltip="Close project credits"
          tooltipContainer={dialog}
          onClick={onClose}
        />
      </header>
      <div className="credits-body">
        <p className="credits-intro">
          Keep the source, permission and attribution with your project.
        </p>
        {entries.length > 0 || selected ? (
          <label className="credit-picker">
            Credit for
            <select
              value={selected?.id ?? ""}
              onChange={(event) =>
                setSelected(
                  entries.find((value) => value.id === event.target.value),
                )
              }
            >
              {!target && (
                <option value={selected?.id ?? ""}>
                  {selected ? `${selected.name} (unavailable)` : "Choose media"}
                </option>
              )}
              {entries.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.name} · {value.kind}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p>Import media to record its credits.</p>
        )}
        {selected && (
          <CreditForm
            key={selected.id}
            snapshot={snapshot}
            target={target ?? selected}
            available={!!target}
          />
        )}
      </div>
    </dialog>
  );
}
