import type {
  GraphicComponent,
  GraphicValues,
  GraphicValue,
} from "../shared/graphics.js";
import type { Result } from "../shared/result.js";

export function validateGraphicProperties(
  component: GraphicComponent,
  values: GraphicValues,
): Result<GraphicValues> {
  for (const key of Object.keys(values)) {
    if (!Object.prototype.hasOwnProperty.call(component.properties, key))
      return {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: `Unknown graphic property: ${key}`,
        },
      };
  }
  const result: GraphicValues = {};
  for (const [name, property] of Object.entries(component.properties)) {
    const value: GraphicValue = Object.prototype.hasOwnProperty.call(
      values,
      name,
    )
      ? values[name]
      : property.default;
    let valid = false;
    if (property.type === "text")
      valid = typeof value === "string" && value.length <= 32768;
    if (property.type === "color")
      valid =
        typeof value === "string" && /^#[\da-f]{6}([\da-f]{2})?$/i.test(value);
    if (property.type === "boolean") valid = typeof value === "boolean";
    if (property.type === "number")
      valid =
        typeof value === "number" &&
        Number.isFinite(value) &&
        (property.min === undefined || value >= property.min) &&
        (property.max === undefined || value <= property.max);
    if (!valid)
      return {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: `Invalid graphic property: ${name}`,
        },
      };
    result[name] = value;
  }
  return { ok: true, value: result };
}
