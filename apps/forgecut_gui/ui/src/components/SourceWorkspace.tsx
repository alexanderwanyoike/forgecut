import { ArrowLeft, Film, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProjectSnapshot } from "../../electron/shared/ipc-contract";
import type { SourceSelectionPatch } from "../../electron/shared/source-selection";
import ActionButton from "./ActionButton";
import PropertyInput from "./PropertyInput";
import PropertyTextarea from "./PropertyTextarea";
import { invokeGrouped, invokeInContext, mediaUrl } from "../lib/bridge";
import "./source-workspace.css";

type Props = {
  snapshot: ProjectSnapshot;
  assetId: string;
  onClose: () => void;
};
export default function SourceWorkspace({ snapshot, assetId, onClose }: Props) {
  const asset = snapshot.project.assets.find((value) => value.id === assetId);
  const selections = (snapshot.project.source_selections ?? []).filter(
    (value) => value.asset_id === assetId,
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    selections[0]?.id ?? null,
  );
  const [draft, setDraft] = useState({
    startUs: 0,
    endUs: asset?.probe?.duration_us ?? 0,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const media = useRef<HTMLMediaElement | null>(null);
  const group = useRef(crypto.randomUUID());
  const selected = selections.find((value) => value.id === selectedId);
  const range = selected
    ? { startUs: selected.source_in_us, endUs: selected.source_out_us }
    : draft;
  const duration = asset?.probe?.duration_us ?? 0;
  const valid =
    range.startUs >= 0 &&
    range.endUs > range.startUs &&
    range.endUs <= duration;
  const target = {
    sessionId: snapshot.sessionId,
    sequenceId:
      snapshot.activeSequenceId ??
      snapshot.project.default_sequence?.id ??
      snapshot.project.id,
  };
  useEffect(() => {
    const element = media.current;
    return () => element?.pause();
  }, [asset?.path]);
  function update(patch: SourceSelectionPatch) {
    if (!selected) return;
    void invokeGrouped(group.current, "update_source_selection", {
      selectionId: selected.id,
      patch,
    }).catch(() => {});
  }
  function changeRange(field: "startUs" | "endUs", text: string) {
    if (!text.trim()) return;
    const value = Number(text);
    if (!Number.isFinite(value)) return;
    const next = { ...range, [field]: Math.round(value * 1_000_000) };
    if (!selected) {
      setDraft(next);
      return;
    }
    if (
      next.startUs < 0 ||
      next.endUs <= next.startUs ||
      next.endUs > duration
    ) {
      setError("Choose an in point before the out point, within the source.");
      return;
    }
    setError(null);
    update(
      field === "startUs"
        ? { source_in_us: next.startUs }
        : { source_out_us: next.endUs },
    );
  }
  async function create() {
    if (!asset || !valid || busy) return;
    setBusy(true);
    try {
      const created = await invokeInContext(target, "save_source_selection", {
        assetId,
        name: `${asset.name.slice(0, 190)} selection`,
        sourceInUs: range.startUs,
        sourceOutUs: range.endUs,
        notes: "",
        rationale: "",
      });
      setSelectedId(created.id);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel source-monitor">
        <div className="panel-header">
          <span>
            <Film size={15} aria-hidden="true" />
            Source monitor
          </span>
          <ActionButton icon={ArrowLeft} onClick={onClose}>
            Canvas
          </ActionButton>
        </div>
        <div className="source-monitor-name" title={asset?.name}>
          {asset?.name ?? "Source unavailable"}
        </div>
        <div className="source-media-stage">
          {!asset ? (
            <p role="alert">The source is no longer available.</p>
          ) : asset.kind === "Audio" ? (
            <audio
              key={asset.path}
              ref={(element) => {
                media.current = element;
              }}
              controls
              src={mediaUrl(asset.path)}
            />
          ) : (
            <video
              key={asset.path}
              ref={(element) => {
                media.current = element;
              }}
              controls
              src={mediaUrl(asset.path)}
            />
          )}
        </div>
        <div className="source-monitor-help">
          Choose source in and out points, then create a selection.
        </div>
      </section>
      <aside className="panel inspector source-selection-inspector">
        <div className="panel-header">
          <span>Source selection</span>
          <span className="panel-count">{selections.length}</span>
        </div>
        <div
          className="inspector-body"
          onFocusCapture={() => {
            group.current = crypto.randomUUID();
          }}
        >
          {error && <div role="alert">{error}</div>}
          <div className="source-range-fields">
            <label>
              Source in (s)
              <PropertyInput
                type="number"
                min={0}
                max={duration / 1_000_000}
                step={0.001}
                value={range.startUs / 1_000_000}
                onValueChange={(value) => changeRange("startUs", value)}
              />
            </label>
            <label>
              Source out (s)
              <PropertyInput
                type="number"
                min={0}
                max={duration / 1_000_000}
                step={0.001}
                value={range.endUs / 1_000_000}
                onValueChange={(value) => changeRange("endUs", value)}
              />
            </label>
          </div>
          <ActionButton
            icon={Plus}
            disabled={!asset || !valid || busy}
            onClick={() => {
              void create().catch(() => {});
            }}
          >
            New selection
          </ActionButton>
          {selected && (
            <label className="source-selection-field">
              Selection name
              <PropertyInput
                maxLength={200}
                value={selected.name}
                onValueChange={(name) => {
                  if (name.trim()) update({ name });
                }}
              />
            </label>
          )}
          {selected && (
            <>
              <label className="source-selection-field">
                Notes
                <PropertyTextarea
                  maxLength={2000}
                  value={selected.notes}
                  onValueChange={(notes) => update({ notes })}
                />
              </label>
              <label className="source-selection-field">
                Rationale
                <PropertyTextarea
                  maxLength={2000}
                  value={selected.rationale}
                  onValueChange={(rationale) => update({ rationale })}
                />
              </label>
            </>
          )}
          <div className="inspector-section-title">Saved selections</div>
          <div className="source-selections-list">
            {selections.length === 0 ? (
              <p>No selections saved yet.</p>
            ) : (
              selections.map((selection) => (
                <ActionButton
                  key={selection.id}
                  aria-pressed={selection.id === selectedId}
                  onClick={() => setSelectedId(selection.id)}
                >
                  <span title={selection.name}>{selection.name}</span>
                </ActionButton>
              ))
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
