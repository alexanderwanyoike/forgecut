import type { GraphicComponent } from "./graphics.js";

export type GraphicDraft = {
  projectId: string;
  itemId: string;
  baseVersion: string;
  revision: number;
  component: GraphicComponent;
};
