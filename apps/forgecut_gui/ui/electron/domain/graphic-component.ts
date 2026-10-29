import type { GraphicComponent } from "../shared/graphics.js";

export function graphicComponentContent(
  component: Omit<GraphicComponent, "id" | "version">,
): string {
  return JSON.stringify(
    canonicalize({
      template_id: component.template_id,
      source: component.source,
      properties: component.properties,
      layers: component.layers,
      design_size: component.design_size,
      dependencies: component.dependencies,
    }),
  );
}
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => {
          if (a < b) return -1;
          if (a > b) return 1;
          return 0;
        })
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  return value;
}
