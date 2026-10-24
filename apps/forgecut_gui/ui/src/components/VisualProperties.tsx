import type {
  ItemPatch,
  Project,
  TimelineItem,
  VisualPlacement,
} from "../../electron/shared/ipc-contract";
import { itemData, itemVariant } from "../../electron/domain/timeline-item";
import { resolveVisualPlacement } from "../../electron/domain/visual-placement";
import NumberProperty from "./NumberProperty";

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
        changes: {
          transform: { ...(item.VideoClip.transform ?? placement), ...changes },
        },
      });
    return update({ kind: "ImageOverlay", changes });
  };
  const trackIndex = project.timeline.tracks.findIndex(
    (track) => track.id === data.track_id,
  );
  const order =
    "layer_order" in data ? (data.layer_order ?? trackIndex) : trackIndex;
  return (
    <>
      {placement && (
        <>
          <NumberProperty
            label="X"
            value={placement.x}
            onValueChange={(x) => {
              void change({ x });
            }}
          />
          <NumberProperty
            label="Y"
            value={placement.y}
            onValueChange={(y) => {
              void change({ y });
            }}
          />
          <NumberProperty
            label="Width"
            value={placement.width}
            onValueChange={(width) => {
              void change({ width });
            }}
            min={1}
          />
          <NumberProperty
            label="Height"
            value={placement.height}
            onValueChange={(height) => {
              void change({ height });
            }}
            min={1}
          />
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
      <NumberProperty
        label="Layer order"
        value={order}
        onValueChange={(layer_order) => {
          if (Number.isSafeInteger(layer_order))
            void update({ kind, changes: { layer_order } });
        }}
      />
    </>
  );
}
