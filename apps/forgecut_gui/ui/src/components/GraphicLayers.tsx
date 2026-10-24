import type {
  GraphicComponent,
  GraphicLayerStates,
  RemotionGraphicItem,
} from "../../electron/shared/graphics";
import type { ItemPatch } from "../../electron/shared/ipc-contract";
import { orderedLayers } from "../lib/preview/graphic-geometry";

type Props = {
  component: GraphicComponent;
  item: RemotionGraphicItem;
  selectedLayerId?: string | null;
  onSelect?: (id: string | null) => void;
  update: (patch: ItemPatch) => Promise<void>;
};
export default function GraphicLayers({
  component,
  item,
  selectedLayerId,
  onSelect,
  update,
}: Props) {
  const layers = orderedLayers(component, item);
  const change = (layer_states: GraphicLayerStates) =>
    update({ kind: "RemotionGraphic", changes: { layer_states } });
  const move = (id: string, direction: number) => {
    const index = layers.findIndex((layer) => layer.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= layers.length) return;
    const reordered = [...layers];
    [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
    void change(
      Object.fromEntries(
        reordered.map((layer, order) => [layer.id, { order }]),
      ),
    );
  };
  return (
    <div className="graphic-layer-list">
      <div className="inspector-section-title">Layers</div>
      <button className="preview-btn" onClick={() => onSelect?.(null)}>
        All properties
      </button>
      {[...layers].reverse().map((layer) => {
        const state = item.layer_states?.[layer.id] ?? {};
        const index = layers.indexOf(layer);
        return (
          <div className="graphic-layer-row" key={layer.id}>
            <button
              className="preview-btn"
              aria-label={`Select ${layer.label} layer`}
              aria-pressed={selectedLayerId === layer.id}
              onClick={() => onSelect?.(layer.id)}
            >
              {layer.label}
            </button>
            <label>
              <input
                type="checkbox"
                aria-label={`Show ${layer.label}`}
                checked={!state.hidden}
                onChange={(event) => {
                  void change({
                    [layer.id]: {
                      hidden: !event.currentTarget.checked,
                    },
                  });
                }}
              />{" "}
              Show
            </label>
            <label>
              <input
                type="checkbox"
                aria-label={`Lock ${layer.label}`}
                checked={state.locked ?? false}
                onChange={(event) => {
                  void change({
                    [layer.id]: {
                      locked: event.currentTarget.checked,
                    },
                  });
                }}
              />{" "}
              Lock
            </label>
            <button
              className="preview-btn"
              aria-label={`Move ${layer.label} forward`}
              disabled={index === layers.length - 1}
              onClick={() => move(layer.id, 1)}
            >
              ↑
            </button>
            <button
              className="preview-btn"
              aria-label={`Move ${layer.label} backward`}
              disabled={index === 0}
              onClick={() => move(layer.id, -1)}
            >
              ↓
            </button>
          </div>
        );
      })}
    </div>
  );
}
