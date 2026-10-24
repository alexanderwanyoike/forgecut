import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { projectForSequence } from "../../electron/domain/project-sequences";
import { resolveGraphicInstance } from "../../electron/domain/graphic-instance";
import { itemData } from "../../electron/domain/timeline-item";
import type { ProjectSnapshot } from "../../electron/shared/ipc-contract";
import { bindEditorContext, invoke } from "../lib/bridge";
import { useEditingContext } from "./useEditingContext";

type Controls = {
  selectedClipId: string | null;
  selectedLayerId: string | null;
  playheadUs: number;
  playing: boolean;
};
const empty: Controls = {
  selectedClipId: null,
  selectedLayerId: null,
  playheadUs: 0,
  playing: false,
};

export function useSequenceEditor(snapshot: ProjectSnapshot | null) {
  const sequenceId =
    snapshot?.activeSequenceId ??
    snapshot?.project.default_sequence?.id ??
    snapshot?.project.id;
  const key = `${snapshot?.sessionId ?? ""}:${sequenceId ?? ""}:${snapshot?.sequenceRevision ?? 0}`;
  const [context, setContext] = useState({ ...empty, key: "", ready: false });
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const project = useMemo(() => {
    if (!snapshot || !sequenceId) return null;
    const selected = projectForSequence(snapshot.project, sequenceId);
    return selected.ok ? selected.value : null;
  }, [snapshot, sequenceId]);
  const ready = context.key === key && context.ready;
  const controls = ready ? context : empty;
  useLayoutEffect(() => {
    if (!ready || !snapshot || !sequenceId) return undefined;
    return bindEditorContext(snapshot.sessionId, sequenceId);
  }, [ready, key]);
  const displayedSnapshot = useMemo(
    () => (snapshot && project && ready ? { ...snapshot, project } : null),
    [snapshot, project, ready],
  );
  useEditingContext(
    displayedSnapshot,
    controls.selectedClipId,
    controls.playheadUs,
    controls.selectedLayerId,
  );

  useEffect(() => {
    if (!snapshot || !project || (context.key === key && context.ready))
      return undefined;
    let cancelled = false;
    setError(null);
    invoke("get_editing_context")
      .then((restored) => {
        if (
          cancelled ||
          restored.sessionId !== snapshot.sessionId ||
          (restored.activeSequenceId &&
            restored.activeSequenceId !== sequenceId)
        )
          return;
        setContext({
          key,
          ready: true,
          playing: false,
          playheadUs: restored.playheadUs,
          selectedClipId: restored.selectedItemIds[0] ?? null,
          selectedLayerId: restored.selectedLayerIds?.[0] ?? null,
        });
      })
      .catch((failure: unknown) => {
        if (!cancelled)
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
      });
    return () => {
      cancelled = true;
    };
  }, [key, snapshot?.revision, attempt]);

  useEffect(() => {
    if (!project) return;
    const ids = new Set(
      project.timeline.tracks.flatMap((track) =>
        track.items.map((item) => itemData(item).id),
      ),
    );
    setContext((current) => {
      if (current.key !== key || !current.ready) return current;
      const selectedClipId =
        current.selectedClipId && ids.has(current.selectedClipId)
          ? current.selectedClipId
          : null;
      const graphic =
        selectedClipId && current.selectedLayerId
          ? resolveGraphicInstance(project, selectedClipId)
          : null;
      const selectedLayerId =
        graphic?.ok &&
        graphic.value.component.layers.some(
          (layer) => layer.id === current.selectedLayerId,
        )
          ? current.selectedLayerId
          : null;
      return { ...current, selectedClipId, selectedLayerId, playing: false };
    });
  }, [key, project]);

  const update = useCallback(
    (change: Partial<Controls>) => {
      setContext((current) =>
        current.key === key && current.ready
          ? { ...current, ...change }
          : current,
      );
    },
    [key],
  );
  const selectClip = useCallback(
    (id: string | null) =>
      update({ selectedClipId: id, selectedLayerId: null }),
    [update],
  );
  const setSelectedLayerId = useCallback(
    (id: string | null) => update({ selectedLayerId: id }),
    [update],
  );
  const setPlayheadUs = useCallback(
    (value: number) => update({ playheadUs: value }),
    [update],
  );
  const setPlaying = useCallback(
    (value: boolean) => update({ playing: value }),
    [update],
  );
  return {
    ...controls,
    project,
    ready,
    key,
    error,
    selectClip,
    setSelectedLayerId,
    setPlayheadUs,
    setPlaying,
    retry: () => setAttempt((value) => value + 1),
  };
}
