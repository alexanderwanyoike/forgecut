import type {
  ItemPatch,
  Project,
  TimelineItem,
  VisualPlacement,
} from "../../electron/shared/ipc-contract";
import { itemData, itemVariant } from "../../electron/domain/timeline-item";
import { resolveVisualPlacement } from "../../electron/domain/visual-placement";
import PropertyInput from "./PropertyInput";

type Props = {
  project: Project;
  item: TimelineItem;
  update: (patch: ItemPatch) => Promise<void>;
};
export default function VisualProperties({ project, item, update }: Props) {
  const kind = itemVariant(item);
  if (kind === "AudioClip") return null;
  const data = itemData(item);
  const placement = resolveVisualPlacement(project, item);
  const change = (changes: Partial<VisualPlacement>) => {
    if ("VideoClip" in item && placement)
      return update({
        kind: "VideoClip",
        changes: { transform: { ...placement, ...changes } },
      });
    return update({ kind: "ImageOverlay", changes });
  };
  const numberField = (
    label: string,
    value: number,
    onChange: (next: number) => void,
    min?: number,
  ) => (
    <label className="inspector-row" key={label}>
      <span className="inspector-label">{label}</span>
      <PropertyInput
        className="inspector-input-sm"
        type="number"
        min={min}
        value={value}
        onValueChange={(raw) => {
          if (raw === "") return;
          const next = Number(raw);
          if (Number.isFinite(next) && (min === undefined || next >= min))
            onChange(next);
        }}
      />
    </label>
  );
  const trackIndex = project.timeline.tracks.findIndex(
    (track) => track.id === data.track_id,
  );
  const order =
    "layer_order" in data ? (data.layer_order ?? trackIndex) : trackIndex;
  return (
    <>
      {placement && (
        <>
          {numberField("X", placement.x, (x) => {
            void change({ x });
          })}
          {numberField("Y", placement.y, (y) => {
            void change({ y });
          })}
          {numberField(
            "Width",
            placement.width,
            (width) => {
              void change({ width });
            },
            1,
          )}
          {numberField(
            "Height",
            placement.height,
            (height) => {
              void change({ height });
            },
            1,
          )}
          <label className="inspector-row">
            <span className="inspector-label">Fit</span>
            <select
              className="inspector-input"
              value={placement.fit}
              onChange={(event) => {
                const fit = event.currentTarget.value;
                if (fit === "contain" || fit === "cover") void change({ fit });
              }}
            >
              <option value="contain">Fit inside</option>
              <option value="cover">Fill and crop</option>
            </select>
          </label>
          <label className="inspector-row">
            <span className="inspector-label">Opacity</span>
            <input
              type="range"
              className="inspector-slider"
              min="0"
              max="1"
              step="0.01"
              value={placement.opacity}
              onChange={(event) =>
                change({ opacity: Number(event.currentTarget.value) })
              }
            />
          </label>
        </>
      )}
      {numberField("Layer order", order, (layer_order) => {
        if (Number.isSafeInteger(layer_order))
          void update({ kind, changes: { layer_order } });
      })}
    </>
  );
}
