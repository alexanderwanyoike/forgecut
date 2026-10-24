import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Layers3,
  LockKeyhole,
  LockKeyholeOpen,
} from "lucide-react";
import ActionButton from "./ActionButton";
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
      <ActionButton
        className="all-properties"
        icon={Layers3}
        aria-pressed={!selectedLayerId}
        onClick={() => onSelect?.(null)}
      >
        All properties
      </ActionButton>
      {[...layers].reverse().map((layer) => {
        const state = item.layer_states?.[layer.id] ?? {};
        const index = layers.indexOf(layer);
        return (
          <div className="graphic-layer-row" key={layer.id}>
            <ActionButton
              className="layer-select"
              tooltip={`Select ${layer.label} layer`}
              aria-label={`Select ${layer.label} layer`}
              aria-pressed={selectedLayerId === layer.id}
              onClick={() => onSelect?.(layer.id)}
            >
              {layer.label}
            </ActionButton>
            <ActionButton
              icon={state.hidden ? EyeOff : Eye}
              iconOnly
              tooltip={`Show ${layer.label}`}
              role="checkbox"
              aria-checked={!state.hidden}
              onClick={() => {
                void change({ [layer.id]: { hidden: !state.hidden } });
              }}
            />
            <ActionButton
              icon={state.locked ? LockKeyhole : LockKeyholeOpen}
              iconOnly
              tooltip={`Lock ${layer.label}`}
              role="checkbox"
              aria-checked={state.locked ?? false}
              onClick={() => {
                void change({ [layer.id]: { locked: !state.locked } });
              }}
            />
            <ActionButton
              icon={ArrowUp}
              iconOnly
              tooltip={`Move ${layer.label} forward`}
              aria-label={`Move ${layer.label} forward`}
              disabled={index === layers.length - 1}
              onClick={() => move(layer.id, 1)}
            ></ActionButton>
            <ActionButton
              icon={ArrowDown}
              iconOnly
              tooltip={`Move ${layer.label} backward`}
              aria-label={`Move ${layer.label} backward`}
              disabled={index === 0}
              onClick={() => move(layer.id, -1)}
            ></ActionButton>
          </div>
        );
      })}
    </div>
  );
}
