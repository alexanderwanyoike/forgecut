import type {
  GraphicComponent,
  RemotionGraphicItem,
} from "../shared/graphics.js";

export function lockedGraphicProperties(
  component: GraphicComponent,
  item: RemotionGraphicItem,
): Set<string> {
  return new Set(
    component.layers
      .filter((layer) => item.layer_states?.[layer.id]?.locked)
      .flatMap((layer) => Object.values(layer.bindings)),
  );
}
