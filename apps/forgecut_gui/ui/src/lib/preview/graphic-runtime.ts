import titleSource from "../../../electron/graphics/TitleCard?raw";
import type { GraphicComponent } from "../../../electron/shared/graphics";

export function isPackagedGraphic(component: GraphicComponent): boolean {
  return (
    component.source.files[component.source.entry] === titleSource &&
    Object.keys(component.source.files).length === 1 &&
    component.dependencies.packages.remotion === "4.0.537" &&
    component.dependencies.packages.react === "18.3.1" &&
    component.dependencies.assets.length === 0 &&
    component.dependencies.fonts.length === 0
  );
}
