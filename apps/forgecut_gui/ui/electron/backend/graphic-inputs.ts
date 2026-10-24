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
  for (const [key, property] of Object.entries(component.properties)) {
    if (property.type !== "font" || !values[key]) continue;
    const resource = project.resources?.find(
      (candidate) => candidate.id === values[key] && candidate.kind === "Font",
    );
    if (!resource)
      return {
        ok: false,
        error: {
          code: "MISSING_RESOURCE",
          message: `Missing font resource for ${property.label}`,
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
