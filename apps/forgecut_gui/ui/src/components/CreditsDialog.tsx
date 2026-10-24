import { FileBadge, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  const dialog = useRef<HTMLDialogElement>(null);
  const [selectedId, setSelectedId] = useState(
    snapshot.project.assets[0]?.id ?? "",
  );
  const asset = snapshot.project.assets.find(
    (value) => value.id === selectedId,
  );
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="credits-dialog"
      aria-labelledby="credits-heading"
      onCancel={onClose}
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
          onClick={onClose}
        />
      </header>
      <div className="credits-body">
        <p className="credits-intro">
          Keep the source, permission and attribution with your project.
        </p>
        {snapshot.project.assets.length > 0 ? (
          <label className="credit-picker">
            Credit for
            <select
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {snapshot.project.assets.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.name} · {value.kind}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p>Import media to record its credits.</p>
        )}
        {asset && (
          <CreditForm key={asset.id} snapshot={snapshot} asset={asset} />
        )}
      </div>
    </dialog>
  );
}
