import { readFileSync } from "node:fs";
import type { GraphicComponent } from "../shared/graphics.js";
import { graphicTemplateDefinitions } from "../domain/graphic-templates.js";
import { componentVersion } from "./graphic-component.js";

export function graphicTemplates(): GraphicComponent[] {
  const source = readFileSync(
    new URL("../graphics/TitleCard.tsx", import.meta.url),
    "utf8",
  );
  return graphicTemplateDefinitions(source).map((component) => ({
    ...component,
    version: componentVersion(component),
  }));
}
