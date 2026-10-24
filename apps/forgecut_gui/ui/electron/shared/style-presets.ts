import type { RemotionGraphicItem } from "./graphics.js";

export type StylePreset = Pick<
  RemotionGraphicItem,
  "component_id" | "component_version" | "props"
> & {
  id: string;
  name: string;
  purpose: "card" | "ending";
};
export type StylePresetInput = {
  sourceSequenceId: string;
  itemId: string;
  name: string;
  purpose: StylePreset["purpose"];
};
