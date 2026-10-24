import type { GraphicValues, GraphicLayerStates } from "./graphics.js";
import type { GraphicResourceInput } from "./graphic-resources.js";

export type GraphicPreviewInput = {
  key: string;
  code: string;
  resources: Record<string, GraphicResourceInput>;
  values: GraphicValues;
  layerStates?: GraphicLayerStates;
  width: number;
  height: number;
  fps: number;
  duration: number;
  frame: number;
};
export type GraphicPreviewFrame = {
  mimeType: "image/png";
  data: string;
  width: number;
  height: number;
};
