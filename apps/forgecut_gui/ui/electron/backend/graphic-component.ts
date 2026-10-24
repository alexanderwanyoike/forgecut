import { createHash } from "node:crypto";
import type { GraphicComponent } from "../shared/graphics.js";
import { graphicComponentContent } from "../domain/graphic-component.js";

export function componentVersion(
  component: Omit<GraphicComponent, "id" | "version">,
): string {
  return createHash("sha256")
    .update(graphicComponentContent(component))
    .digest("hex");
}
