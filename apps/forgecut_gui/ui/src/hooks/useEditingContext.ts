import { useEffect, useRef } from "react";
import type { ProjectSnapshot } from "../../electron/shared/ipc-contract";
import { invoke } from "../lib/bridge";
import type { Playhead } from "../lib/playhead";
import { getItemData } from "../lib/timeline/items";

/** Shares the editor's selection and playhead; during playback only once it stops. */
export function useEditingContext(
  snapshot: ProjectSnapshot | null,
  selectedItemId: string | null,
  playhead: Playhead,
  playing: boolean,
  selectedLayerId?: string | null,
): void {
  const report = useRef<() => void>(() => {});
  report.current = () => {
    if (!snapshot || playing) return;
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
      playheadUs: playhead.get(),
    }).catch(() => {});
  };
  useEffect(() => {
    report.current();
  }, [snapshot, selectedItemId, selectedLayerId, playing]);
  useEffect(() => playhead.subscribe(() => report.current()), [playhead]);
}
