import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type {
  ProjectSnapshot,
  Timeline,
} from "../../electron/shared/ipc-contract";
import type { StylePreset } from "../../electron/shared/style-presets";
import { graphicPresets } from "../../electron/domain/graphic-presets";
import { invoke } from "../lib/bridge";
import ActionButton from "./ActionButton";

type Props = {
  timeline: Timeline;
  playheadUs: number;
  styles: StylePreset[];
  origin?: Pick<ProjectSnapshot, "sessionId" | "revision">;
  onTimelineChange: (timeline: Timeline) => void;
};
export default function GraphicPicker({
  timeline,
  playheadUs,
  styles,
  origin,
  onTimelineChange,
}: Props) {
  const [graphicPreset, setGraphicPreset] = useState("title-card");
  const choice =
    graphicPreset.startsWith("style:") &&
    !styles.some((style) => `style:${style.id}` === graphicPreset)
      ? "title-card"
      : graphicPreset;
  const [styleBusy, setStyleBusy] = useState(false);
  const selectedStyle = styles.find((style) => `style:${style.id}` === choice);
  const handleAddGraphic = async () => {
    const placement = {
      trackId:
        timeline.tracks.find((track) => track.kind === "Graphics")?.id ??
        crypto.randomUUID(),
      timelineStartUs: playheadUs,
      durationUs: 3000000,
    };
    try {
      const next = choice.startsWith("style:")
        ? await invoke("add_graphic_from_preset", {
            ...placement,
            presetId: choice.slice(6),
          })
        : await invoke("add_graphic_item", {
            ...placement,
            templateId: choice,
          });
      onTimelineChange(next);
    } catch (failure) {
      console.error("Creating graphic failed", failure);
    }
  };

  const handleDeleteStyle = async () => {
    if (!selectedStyle || !origin || styleBusy) return;
    setStyleBusy(true);
    try {
      await invoke("apply_edits", {
        sessionId: origin.sessionId,
        expectedRevision: origin.revision,
        requestId: crypto.randomUUID(),
        operations: [
          {
            command: "delete_style_preset",
            args: { presetId: selectedStyle.id },
          },
        ],
      });
    } finally {
      setStyleBusy(false);
    }
  };

  return (
    <>
      <select
        aria-label="Graphic template"
        disabled={styleBusy}
        value={choice}
        onChange={(event) => setGraphicPreset(event.currentTarget.value)}
      >
        <optgroup label="Templates">
          {graphicPresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </optgroup>
        {styles.length > 0 && (
          <optgroup label="Project styles">
            {styles.map((style) => (
              <option key={style.id} value={`style:${style.id}`}>
                {style.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <ActionButton
        icon={Plus}
        aria-label="Add graphic"
        disabled={styleBusy}
        tooltip="Add graphic at the playhead"
        onClick={handleAddGraphic}
      >
        Graphic
      </ActionButton>
      {selectedStyle && (
        <ActionButton
          icon={Trash2}
          iconOnly
          tooltip={`Delete style: ${selectedStyle.name}`}
          disabled={styleBusy || !origin}
          onClick={() => {
            void handleDeleteStyle().catch(() => {});
          }}
        />
      )}
    </>
  );
}
