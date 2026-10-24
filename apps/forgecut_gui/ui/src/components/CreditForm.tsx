import { RefreshCw, Save, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type {
  EditOperation,
  ProjectSnapshot,
} from "../../electron/shared/ipc-contract";
import type { ResourceLicense } from "../../electron/shared/graphic-resources";
import { invokeInContext } from "../lib/bridge";
import ActionButton from "./ActionButton";

export type CreditTarget = {
  id: string;
  type: "asset" | "resource";
  license?: ResourceLicense;
};

export default function CreditForm({
  snapshot,
  target,
  available,
}: {
  snapshot: ProjectSnapshot;
  target: CreditTarget;
  available: boolean;
}) {
  const [draft, setDraft] = useState<ResourceLicense>(
    target.license ?? { identifier: "", text: "" },
  );
  const currentLicense = JSON.stringify(target.license ?? null);
  const [baseLicense, setBaseLicense] = useState(currentLicense);
  const changed = currentLicense !== baseLicense;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const set = (key: keyof ResourceLicense, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage("");
  };
  const commit = async (license: ResourceLicense | null) => {
    if (changed || !available) return;
    let operation: EditOperation;
    if (target.type === "asset")
      operation = {
        command: "set_asset_license",
        args: { assetId: target.id, license },
      };
    else if (license)
      operation = {
        command: "set_resource_license",
        args: { resourceId: target.id, license },
      };
    else return;
    setBusy(true);
    setError("");
    try {
      const saved = await invokeInContext(
        {
          sessionId: snapshot.sessionId,
          sequenceId:
            snapshot.activeSequenceId ??
            snapshot.project.default_sequence?.id ??
            snapshot.project.id,
        },
        "apply_edits",
        {
          sessionId: snapshot.sessionId,
          expectedRevision: snapshot.revision,
          requestId: crypto.randomUUID(),
          operations: [operation],
        },
      );
      const acknowledged =
        target.type === "asset"
          ? saved.project.assets.find((value) => value.id === target.id)
              ?.license
          : saved.project.resources?.find((value) => value.id === target.id)
              ?.license;
      setBaseLicense(JSON.stringify(acknowledged ?? null));
      setDraft(acknowledged ?? { identifier: "", text: "" });
      setMessage(license ? "Credits saved" : "Credit removed");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    void commit({
      identifier: draft.identifier,
      text: draft.text,
      ...(draft.attribution ? { attribution: draft.attribution } : {}),
      ...(draft.source_url ? { source_url: draft.source_url } : {}),
    });
  };
  return (
    <form className="credit-form" onSubmit={save}>
      <label>
        Licence / permission
        <input
          autoFocus
          required
          maxLength={256}
          value={draft.identifier}
          disabled={busy}
          onChange={(event) => set("identifier", event.target.value)}
        />
      </label>
      <label>
        Attribution
        <input
          maxLength={2048}
          value={draft.attribution ?? ""}
          disabled={busy}
          onChange={(event) => set("attribution", event.target.value)}
        />
      </label>
      <label>
        Source URL
        <input
          type="url"
          maxLength={2048}
          value={draft.source_url ?? ""}
          disabled={busy}
          onChange={(event) => set("source_url", event.target.value)}
        />
      </label>
      <label>
        Licence notice
        <textarea
          required
          rows={7}
          maxLength={65536}
          value={draft.text}
          disabled={busy}
          onChange={(event) => set("text", event.target.value)}
        />
      </label>
      {!available && (
        <p role="alert">
          This media is no longer available. Choose another credit above.
        </p>
      )}
      {available && changed && (
        <div className="credit-conflict" role="alert">
          <p>Credits changed elsewhere. Reload before saving.</p>
          <ActionButton
            icon={RefreshCw}
            disabled={busy}
            onClick={() => {
              setBaseLicense(currentLicense);
              setDraft(target.license ?? { identifier: "", text: "" });
              setMessage("");
              setError("");
            }}
          >
            Reload credits
          </ActionButton>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="credit-actions">
        <ActionButton
          type="submit"
          icon={Save}
          className="primary-action"
          disabled={
            busy || changed || !available || !draft.identifier || !draft.text
          }
        >
          Save credits
        </ActionButton>
        {target.type === "asset" && target.license && (
          <ActionButton
            icon={Trash2}
            disabled={busy || changed || !available}
            onClick={() => {
              void commit(null);
            }}
          >
            Remove credit
          </ActionButton>
        )}
      </div>
    </form>
  );
}
