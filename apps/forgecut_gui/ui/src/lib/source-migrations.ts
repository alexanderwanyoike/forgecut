import type { GraphicMigration } from "../../electron/shared/graphic-promotion";
import type { Result } from "../../electron/shared/result";

export function parseSourceMigrations(text: string): Result<GraphicMigration> {
  try {
    const value: unknown = JSON.parse(text || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Use a migration object");
    const result: GraphicMigration = {};
    for (const [key, entries] of Object.entries(value)) {
      if (key !== "properties" && key !== "layers")
        throw new Error("Use properties and layers for migration mappings");
      if (!entries || typeof entries !== "object" || Array.isArray(entries))
        throw new Error("Mappings must be objects");
      let mappings: Record<string, string | null> = {};
      for (const [from, to] of Object.entries(
        entries as Record<string, unknown>,
      )) {
        if (typeof to !== "string" && to !== null)
          throw new Error("Map old stable IDs to new IDs or null");
        mappings = { ...mappings, [from]: to };
      }
      result[key] = mappings;
    }
    return { ok: true, value: result };
  } catch (failure) {
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: failure instanceof Error ? failure.message : String(failure),
      },
    };
  }
}
