import type {
  GraphicComponent,
  RemotionGraphicItem,
  GraphicValues,
  GraphicLayerStates,
} from "../shared/graphics.js";
import type { GraphicMigration } from "../shared/graphic-promotion.js";
import type { Result } from "../shared/result.js";
import { validateGraphicProperties } from "./graphic-properties.js";

function identities(
  previous: { id: string }[],
  next: { id: string }[],
  explicit: Record<string, string | null> = {},
): Result<Map<string, string | null>> {
  const oldIds = new Set(previous.map((value) => value.id));
  const newIds = new Set(next.map((value) => value.id));
  const mapped = new Map<string, string | null>();
  const targets = new Set<string>();
  for (const [from, to] of Object.entries(explicit)) {
    if (!oldIds.has(from) || (to !== null && !newIds.has(to)))
      return {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: "Migration refers to an unknown stable ID",
        },
      };
  }
  for (const from of oldIds) {
    let to: string | null | undefined;
    if (Object.prototype.hasOwnProperty.call(explicit, from))
      to = explicit[from];
    else if (newIds.has(from)) to = from;
    if (to === undefined)
      return {
        ok: false,
        error: {
          code: "MIGRATION_REQUIRED",
          message: `Explicitly map or discard removed stable ID ${from}`,
        },
      };
    if (to !== null) {
      if (targets.has(to))
        return {
          ok: false,
          error: {
            code: "INVALID_INPUT",
            message: "Multiple old values cannot map to one stable ID",
          },
        };
      targets.add(to);
    }
    mapped.set(from, to);
  }
  return { ok: true, value: mapped };
}

export function migrateGraphicInstance(
  previous: GraphicComponent,
  next: GraphicComponent,
  item: RemotionGraphicItem,
  mappings: GraphicMigration = {},
): Result<RemotionGraphicItem> {
  const properties = identities(
    Object.values(previous.properties),
    Object.values(next.properties),
    mappings.properties,
  );
  if (!properties.ok) return properties;
  const layers = identities(previous.layers, next.layers, mappings.layers);
  if (!layers.ok) return layers;
  const values: GraphicValues = {};
  const nextProperties = new Map(
    Object.entries(next.properties).map(([key, property]) => [
      property.id,
      { key, property },
    ]),
  );
  for (const [key, property] of Object.entries(previous.properties)) {
    const targetId = properties.value.get(property.id);
    if (targetId === null || targetId === undefined) continue;
    const target = nextProperties.get(targetId);
    if (!target) continue;
    if (
      property.type !== target.property.type &&
      !Object.prototype.hasOwnProperty.call(
        mappings.properties ?? {},
        property.id,
      )
    )
      return {
        ok: false,
        error: {
          code: "MIGRATION_REQUIRED",
          message: `Explicitly map or reset changed property ${property.label}`,
        },
      };
    values[target.key] = Object.prototype.hasOwnProperty.call(item.props, key)
      ? item.props[key]
      : property.default;
  }
  const validated = validateGraphicProperties(next, values);
  if (!validated.ok) return validated;
  const states: GraphicLayerStates = {};
  for (const [id, state] of Object.entries(item.layer_states ?? {})) {
    const target = layers.value.get(id);
    if (target) states[target] = { ...state };
  }
  return {
    ok: true,
    value: {
      ...item,
      component_id: next.id,
      component_version: next.version,
      props: validated.value,
      ...(item.layer_states ? { layer_states: states } : {}),
    },
  };
}
