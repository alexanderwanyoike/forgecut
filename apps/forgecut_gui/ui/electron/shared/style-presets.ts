import type { RemotionGraphicItem } from "./graphics.js";

export type StylePreset = Pick<
  RemotionGraphicItem,
  "component_id" | "component_version" | "props" | "layer_states" | "transform"
> & {
  canvas_size: { width: number; height: number };
  id: string;
  name: string;
  purpose: "card" | "ending";
};
export type StylePresetInput = {
  presetId?: string;
  sourceSequenceId: string;
  itemId: string;
  name: string;
  purpose: StylePreset["purpose"];
};
