import type { GraphicComponent, GraphicValues } from "../shared/graphics.js";

type Size = GraphicComponent["design_size"];
export function scaleGraphicProperties(
  component: GraphicComponent,
  values: GraphicValues,
  from: Size,
  to: Size,
): GraphicValues {
  const result = { ...values };
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  const scaled = new Set<string>();
  for (const layer of component.layers) {
    const bindings: [string, number][] = [
      [layer.bindings.x, sx],
      [layer.bindings.width, sx],
      [layer.bindings.y, sy],
      [layer.bindings.height, sy],
    ];
    if (layer.kind === "text")
      bindings.push([layer.bindings.font_size, Math.min(sx, sy)]);
    for (const [key, factor] of bindings) {
      if (scaled.has(key)) continue;
      scaled.add(key);
      const value = values[key];
      const property = component.properties[key];
      if (typeof value === "number" && property.type === "number")
        result[key] = Math.max(
          property.min ?? -Infinity,
          Math.min(property.max ?? Infinity, value * factor),
        );
    }
  }
  return result;
}
