import { useEffect } from "react";
import type {
  ProjectSnapshot,
  TimeUs,
} from "../../electron/shared/ipc-contract";
import { invoke } from "../lib/bridge";
import { getItemData } from "../lib/timeline/items";

export function useEditingContext(
  snapshot: ProjectSnapshot | null,
  selectedItemId: string | null,
  playheadUs: TimeUs,
): void {
  useEffect(() => {
    if (!snapshot) return;
    const selectedItemIds = snapshot.project.timeline.tracks
      .flatMap((track) => track.items)
      .filter((item) => getItemData(item).id === selectedItemId)
      .map((item) => getItemData(item).id);
    void invoke("set_editing_context", {
      sessionId: snapshot.sessionId,
      selectedItemIds,
      playheadUs,
    }).catch(() => {});
  }, [snapshot, selectedItemId, playheadUs]);
}
