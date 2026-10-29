import type { GraphicComponent, GraphicProperty } from "./graphics.js";

function valueType(property: GraphicProperty): string {
  if (property.type === "number" || property.type === "boolean")
    return property.type;
  if (property.type === "select")
    return property.options
      .map((option) => JSON.stringify(option.value))
      .join(" | ");
  return "string";
}

export function graphicTypeDeclarations(
  properties: GraphicComponent["properties"],
): string {
  const values = Object.keys(properties)
    .sort()
    .map((key) => `${JSON.stringify(key)}: ${valueType(properties[key])};`)
    .join("\n");
  return `declare namespace ForgeCut {
    interface Values { ${values} }
    interface Resource { url: string; sha256: string; mime: string; }
    interface LayerState { hidden?: boolean; locked?: boolean; order?: number; }
    interface Props { values: Values; resources: Record<string,Resource>; layerStates?: Record<string,LayerState>; }
  }`;
}
