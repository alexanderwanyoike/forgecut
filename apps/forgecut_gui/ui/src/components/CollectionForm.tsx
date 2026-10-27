import { FolderArchive, FolderOpen } from "lucide-react";
import { useState } from "react";
import type { ProjectSnapshot } from "../../electron/shared/ipc-contract";
import type { ProjectCollectionRequest } from "../../electron/shared/project-collection";
import { save } from "../lib/bridge";
import ActionButton from "./ActionButton";

export default function CollectionForm({
  snapshot,
  busy,
  dialog,
  onCollect,
  failure,
}: {
  snapshot: ProjectSnapshot | null;
  busy: boolean;
  failure: string | null;
  dialog: HTMLDialogElement | null;
  onCollect: (request: ProjectCollectionRequest, name: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState(
    () => snapshot?.project.assets.map((asset) => asset.id) ?? [],
  );
  const [directory, setDirectory] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const assets = snapshot?.project.assets ?? [];
  const disabled = busy || choosing;
  async function browse() {
    setChoosing(true);
    setError(null);
    try {
      const path = await save({
        title: "Choose a new collection folder",
        buttonLabel: "Choose location",
        defaultPath: "Collected project",
      });
      if (path) setDirectory(path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setChoosing(false);
    }
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!snapshot || disabled || !directory.trim()) return;
        void onCollect(
          {
            sessionId: snapshot.sessionId,
            expectedRevision: snapshot.revision,
            requestId: crypto.randomUUID(),
            directory: directory.trim(),
            assetIds: selected.filter((id) =>
              assets.some((asset) => asset.id === id),
            ),
          },
          snapshot.project.name,
        );
      }}
    >
      <div className="collection-body">
        <p className="collection-note">
          Graphic source, artwork, fonts and notices are included. Unchecked
          media stays external.
        </p>
        <fieldset className="collection-assets" disabled={disabled}>
          <legend>Media to include</legend>
          {assets.map((asset) => (
            <label key={asset.id}>
              <input
                type="checkbox"
                aria-label={`Include ${asset.name}`}
                checked={selected.includes(asset.id)}
                onChange={(event) => {
                  const { checked } = event.currentTarget;
                  setSelected((current) =>
                    checked
                      ? [...current, asset.id]
                      : current.filter((id) => id !== asset.id),
                  );
                }}
              />
              <span title={asset.name}>{asset.name}</span>
              <small>{asset.kind}</small>
            </label>
          ))}
          {!assets.length && (
            <p>No media to copy. Project graphics will still be included.</p>
          )}
        </fieldset>
        <div className="collection-location">
          <label>
            Collection folder
            <input
              value={directory}
              disabled={disabled}
              placeholder="Choose a new folder"
              onChange={(event) => setDirectory(event.target.value)}
            />
          </label>
          <ActionButton
            icon={FolderOpen}
            tooltip="Choose a location for a new collection folder"
            tooltipContainer={dialog}
            disabled={disabled}
            onClick={browse}
          >
            Browse
          </ActionButton>
        </div>
        {(error || failure) && (
          <p className="collection-error" role="alert">
            {error || failure}
          </p>
        )}
      </div>
      <footer className="collection-footer">
        <ActionButton
          type="submit"
          icon={FolderArchive}
          className="primary-action"
          disabled={disabled || !snapshot || !directory.trim()}
        >
          {busy ? "Starting collection" : "Collect project"}
        </ActionButton>
      </footer>
    </form>
  );
}
