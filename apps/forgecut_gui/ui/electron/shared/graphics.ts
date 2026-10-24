import type { VisualPlacement } from "./ipc-contract.js";

export type GraphicValue = string | number | boolean | null;
export type GraphicValues = Record<string, GraphicValue>;

type PropertyBase = { id: string; label: string };
export type GraphicProperty = PropertyBase &
  (
    | { type: "text" | "color" | "font"; default: string }
    | { type: "number"; default: number; min?: number; max?: number }
    | { type: "boolean"; default: boolean }
  );
export type GraphicLayer = {
  id: string;
  name: string;
  label: string;
  kind: "text";
  bindings: {
    x: string;
    y: string;
    width: string;
    height: string;
    text: string;
    color: string;
    font_size: string;
    opacity: string;
  };
};
export type GraphicComponent = {
  id: string;
  template_id: string;
  version: string;
  name: string;
  design_size: { width: number; height: number };
  source: { entry: string; files: Record<string, string> };
  properties: Record<string, GraphicProperty>;
  layers: GraphicLayer[];
  dependencies: {
    packages: Record<string, string>;
    assets: string[];
    fonts: string[];
  };
};
export type RemotionGraphicItem = {
  id: string;
  track_id: string;
  timeline_start_us: number;
  duration_us: number;
  component_id: string;
  component_version: string;
  props: GraphicValues;
  transform?: VisualPlacement;
  layer_order?: number;
};
