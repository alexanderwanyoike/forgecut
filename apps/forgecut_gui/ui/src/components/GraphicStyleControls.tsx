import { Save, X } from "lucide-react";
import { useState } from "react";
import type {
  GraphicComponent,
  RemotionGraphicItem,
} from "../../electron/shared/graphics";
import type { Project } from "../../electron/shared/ipc-contract";
import type { StylePreset } from "../../electron/shared/style-presets";
import { invokeInContext } from "../lib/bridge";
import ActionButton from "./ActionButton";
import "./graphic-style-controls.css";

type Props = {
  project: Project;
  sessionId: string;
  revision: number;
  item: RemotionGraphicItem;
  component: GraphicComponent;
};
export default function GraphicStyleControls({
  project,
  sessionId,
  revision,
  item,
  component,
}: Props) {
  const [open, setOpen] = useState(false);
  const [presetId, setPresetId] = useState("");
  const [baseStyle, setBaseStyle] = useState<string | null>(null);
  const styles = project.style_presets ?? [];
  const destination = styles.find((style) => style.id === presetId);
  const missing = !!presetId && !destination;
  const changed = !!destination && baseStyle !== JSON.stringify(destination);
  const [name, setName] = useState(`${component.name.slice(0, 190)} style`);
  const [purpose, setPurpose] = useState<StylePreset["purpose"]>(
    component.template_id === "ending-card" ? "ending" : "card",
  );
  const [busy, setBusy] = useState(false);
  function chooseStyle(id: string) {
    const style = styles.find((value) => value.id === id);
    setPresetId(id);
    setBaseStyle(style ? JSON.stringify(style) : null);
    if (style) {
      setName(style.name);
      setPurpose(style.purpose);
    }
  }
  async function save() {
    if (!name.trim() || busy || missing || changed) return;
    setBusy(true);
    const sequenceId = project.default_sequence?.id ?? project.id;
    try {
      await invokeInContext({ sessionId, sequenceId }, "apply_edits", {
        sessionId,
        sequenceId,
        expectedRevision: revision,
        requestId: crypto.randomUUID(),
        operations: [
          {
            command: "save_style_preset",
            args: {
              ...(presetId ? { presetId } : {}),
              sourceSequenceId: sequenceId,
              itemId: item.id,
              name,
              purpose,
            },
          },
        ],
      });
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="graphic-style-controls">
      <ActionButton
        icon={Save}
        aria-label="Save project style"
        tooltip="Save the applied graphic as an independent project style"
        disabled={busy}
        onClick={() => setOpen(!open)}
      >
        Save style
      </ActionButton>
      {open && (
        <form
          className="graphic-style-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save().catch(() => {});
          }}
        >
          {(styles.length > 0 || presetId) && (
            <label>
              Style destination
              <select
                value={presetId}
                disabled={busy}
                onChange={(event) => {
                  chooseStyle(event.currentTarget.value);
                }}
              >
                <option value="">New style</option>
                {missing && (
                  <option value={presetId}>Style no longer available</option>
                )}
                {styles.map((style) => (
                  <option key={style.id} value={style.id}>
                    {style.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {changed && (
            <div role="status" className="graphic-style-notice">
              <p>This style changed. Reload its details before replacing it.</p>
              <ActionButton onClick={() => chooseStyle(presetId)}>
                Reload style
              </ActionButton>
            </div>
          )}
          {missing && (
            <p role="status">
              This style was removed. Choose a new destination.
            </p>
          )}
          <label>
            Style name
            <input
              value={name}
              maxLength={200}
              disabled={busy}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <label>
            Purpose
            <select
              value={purpose}
              disabled={busy}
              onChange={(event) =>
                setPurpose(
                  event.currentTarget.value === "ending" ? "ending" : "card",
                )
              }
            >
              <option value="card">Card</option>
              <option value="ending">Ending</option>
            </select>
          </label>
          <div className="graphic-style-actions">
            <ActionButton
              icon={Save}
              type="submit"
              disabled={busy || !name.trim() || missing || changed}
            >
              {presetId ? "Replace style" : "Create style"}
            </ActionButton>
            <ActionButton
              icon={X}
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </ActionButton>
          </div>
        </form>
      )}
    </div>
  );
}
