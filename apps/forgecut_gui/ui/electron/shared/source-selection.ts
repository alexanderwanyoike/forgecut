import type { TimeUs } from "./ipc-contract.js";

export type SourceSelection = {
  id: string;
  asset_id: string;
  name: string;
  source_in_us: TimeUs;
  source_out_us: TimeUs;
  notes: string;
  rationale: string;
};
export type SourceSelectionInput = {
  selectionId?: string;
  assetId: string;
  name: string;
  sourceInUs: TimeUs;
  sourceOutUs: TimeUs;
  notes: string;
  rationale: string;
};
