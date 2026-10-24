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
  selectedLayerId?: string | null,
): void {
  useEffect(() => {
    if (!snapshot) return;
    const sequenceId =
      snapshot.project.default_sequence?.id ?? snapshot.project.id;
    if (snapshot.activeSequenceId && snapshot.activeSequenceId !== sequenceId)
      return;
    const selectedItemIds = snapshot.project.timeline.tracks
      .flatMap((track) => track.items)
      .filter((item) => getItemData(item).id === selectedItemId)
      .map((item) => getItemData(item).id);
    void invoke("set_editing_context", {
      sessionId: snapshot.sessionId,
      sequenceRevision: snapshot.sequenceRevision,
      sequenceId,
      selectedItemIds,
      selectedLayerIds: selectedLayerId ? [selectedLayerId] : [],
      playheadUs,
    }).catch(() => {});
  }, [snapshot, selectedItemId, playheadUs, selectedLayerId]);
}
