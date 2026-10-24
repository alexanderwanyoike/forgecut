import titleSource from "../../../electron/graphics/TitleCard?raw";
import type { GraphicComponent } from "../../../electron/shared/graphics";
import { graphicTemplateDefinitions } from "../../../electron/domain/graphic-templates";
import { graphicComponentContent } from "../../../electron/domain/graphic-component";

const packaged = graphicTemplateDefinitions(titleSource).map(
  graphicComponentContent,
);
export function isPackagedGraphic(component: GraphicComponent): boolean {
  return packaged.includes(graphicComponentContent(component));
}
