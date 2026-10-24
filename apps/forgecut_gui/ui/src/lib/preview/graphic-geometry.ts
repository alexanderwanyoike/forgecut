import type {
  GraphicComponent,
  GraphicLayer,
  RemotionGraphicItem,
} from "../../../electron/shared/graphics";
import type { VisualPlacement } from "../../../electron/shared/ipc-contract";

export function layerBounds(item: RemotionGraphicItem, layer: GraphicLayer) {
  const { x, y, width, height } = layer.bindings;
  const values = [x, y, width, height].map((key) => item.props[key]);
  if (
    !values.every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  )
    return null;
  return {
    x: Number(values[0]),
    y: Number(values[1]),
    width: Number(values[2]),
    height: Number(values[3]),
  };
}
export function graphicFit(
  placement: VisualPlacement,
  settings: { width: number; height: number },
) {
  const scale = (placement.fit === "cover" ? Math.max : Math.min)(
    placement.width / settings.width,
    placement.height / settings.height,
  );
  return {
    scale,
    x: (placement.width - settings.width * scale) / 2,
    y: (placement.height - settings.height * scale) / 2,
  };
}
export function orderedLayers(
  component: GraphicComponent,
  item: RemotionGraphicItem,
): GraphicLayer[] {
  return component.layers
    .map((layer, index) => ({
      layer,
      order: item.layer_states?.[layer.id]?.order ?? index,
      index,
    }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ layer }) => layer);
}
