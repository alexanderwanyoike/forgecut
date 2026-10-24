import type { Project } from "../shared/ipc-contract.js";
import type { GraphicComponent, GraphicValues } from "../shared/graphics.js";
import type { GraphicResourceInput } from "../shared/graphic-resources.js";
import type { Result } from "../shared/result.js";
import { readGraphicResource } from "./graphic-resource-store.js";

export async function graphicResourceInputs(
  project: Project,
  component: GraphicComponent,
  values: GraphicValues,
): Promise<Result<Record<string, GraphicResourceInput>>> {
  const inputs: Record<string, GraphicResourceInput> = {};
  let size = 0;
  const references = Object.entries(component.properties).flatMap(
    ([key, property]) =>
      (property.type === "font" || property.type === "image") && values[key]
        ? [{ id: values[key], kind: property.type, label: property.label }]
        : [],
  );
  references.push(
    ...component.dependencies.assets.map((id) => ({
      id,
      kind: "image" as const,
      label: "declared artwork",
    })),
    ...component.dependencies.fonts.map((id) => ({
      id,
      kind: "font" as const,
      label: "declared font",
    })),
  );
  for (const reference of references) {
    const resource = project.resources?.find(
      (candidate) =>
        candidate.id === reference.id &&
        candidate.kind.toLowerCase() === reference.kind,
    );
    if (!resource)
      return {
        ok: false,
        error: {
          code: "MISSING_RESOURCE",
          message: `Missing resource for ${reference.label}`,
        },
      };
    if (inputs[resource.id]) continue;
    const read = await readGraphicResource(resource);
    if (!read.ok) return read;
    size += read.value.length;
    if (size > 16 * 1024 * 1024)
      return {
        ok: false,
        error: {
          code: "TOO_LARGE",
          message: "Graphic resources exceed 16 MiB for one instance",
        },
      };
    inputs[resource.id] = {
      url: `data:${resource.mime};base64,${read.value.toString("base64")}`,
      sha256: resource.sha256,
      mime: resource.mime,
    };
  }
  return { ok: true, value: inputs };
}
