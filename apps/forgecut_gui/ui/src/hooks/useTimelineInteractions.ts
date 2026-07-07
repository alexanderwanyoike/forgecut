import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { invoke } from "../lib/bridge";
import {
  nearestSnapPoint,
  pixelsToUs,
  timelinePointerUs,
} from "../lib/timeline/geometry";
import type { Timeline } from "../lib/timeline/items";

type DragState = {
  itemId: string;
  startMouseX: number;
  startMouseY: number;
  originalStartUs: number;
  trackId: string;
  trackKind: string;
};

type TrimState = {
  itemId: string;
  edge: "left" | "right";
  startMouseX: number;
  originalUs: number;
};

export interface TimelineInteractionOptions {
  timelineRef: RefObject<HTMLDivElement | null>;
  pixelsPerSecond: number;
  snapping: boolean;
  timeline: Timeline;
  setTimeline: (timeline: Timeline) => void;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  onPlayheadChange: (us: number) => void;
  onSelectClip: (id: string | null) => void;
}

/**
 * Mouse-driven timeline interactions: clip drag/move (with snapping and
 * cross-track moves), edge trimming, and ruler scrubbing. Global listeners
 * delegate through refs reassigned on every render, so handlers always see
 * fresh state.
 */
export function useTimelineInteractions(options: TimelineInteractionOptions) {
  const {
    timelineRef,
    pixelsPerSecond,
    snapping,
    timeline,
    setTimeline,
    playing,
    onPlayingChange,
    onPlayheadChange,
    onSelectClip,
  } = options;

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [trimState, setTrimState] = useState<TrimState | null>(null);
  const [dragTargetTrackId, setDragTargetTrackId] = useState<string | null>(null);
  const [snapLineUs, setSnapLineUs] = useState<number | null>(null);

  // Mirror drag/trim state into refs so the global mouseup handler never
  // acts on a stale closure, even if it fires before the next render.
  const dragStateRef = useRef<DragState | null>(null);
  const trimStateRef = useRef<TrimState | null>(null);
  const rulerDraggingRef = useRef(false);
  const snapPointsCacheRef = useRef<number[] | null>(null);

  const setDragStateValue = useCallback((next: DragState | null) => {
    dragStateRef.current = next;
    setDragState(next);
  }, []);

  const setTrimStateValue = useCallback((next: TrimState | null) => {
    trimStateRef.current = next;
    setTrimState(next);
  }, []);

  const calcPlayheadFromClientX = (clientX: number): number => {
    if (!timelineRef.current) return 0;
    const rect = timelineRef.current.getBoundingClientRect();
    return timelinePointerUs(
      clientX,
      rect.left,
      timelineRef.current.scrollLeft,
      pixelsPerSecond,
    );
  };

  const getTrackAtY = (clientY: number): { id: string; kind: string } | null => {
    const lanes = document.querySelectorAll(".track-lane");
    for (const lane of lanes) {
      const rect = lane.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        const trackIndex = Array.from(lanes).indexOf(lane);
        const track = timeline.tracks[trackIndex];
        if (track) return { id: track.id, kind: track.kind };
      }
    }
    return null;
  };

  // --- Global mouse up: commit drag or trim ---
  const handleGlobalMouseUpRef = useRef<(e: MouseEvent) => void>(() => {});
  handleGlobalMouseUpRef.current = async (e: MouseEvent) => {
    const ds = dragStateRef.current;
    const ts = trimStateRef.current;

    if (ds) {
      const dx = e.clientX - ds.startMouseX;
      const deltaUs = pixelsToUs(dx, pixelsPerSecond);
      let newStartUs = Math.max(0, Math.round(ds.originalStartUs + deltaUs));
      const targetTrack = getTrackAtY(e.clientY);
      setDragStateValue(null);
      setSnapLineUs(null);
      setDragTargetTrackId(null);
      // Plain click selects (done on mousedown); only the ruler moves the playhead
      if (Math.abs(dx) < 3 && Math.abs(e.clientY - ds.startMouseY) < 3) return;

      if (snapping) {
        try {
          const snapPoints = await invoke("get_snap_points", {
            excludeItemId: ds.itemId,
          });
          const thresholdUs = Math.round(pixelsToUs(5, pixelsPerSecond));
          newStartUs = nearestSnapPoint(newStartUs, snapPoints, thresholdUs) ?? newStartUs;
        } catch (_) {}
      }

      // Cross-track move if target is a different track of the same kind
      if (targetTrack && targetTrack.id !== ds.trackId && targetTrack.kind === ds.trackKind) {
        try {
          const tl = await invoke("move_clip_to_track", {
            itemId: ds.itemId,
            newTrackId: targetTrack.id,
            newStartUs,
          });
          setTimeline(tl);
        } catch (err) {
          console.error("move_clip_to_track failed:", err);
        }
      } else {
        try {
          const tl = await invoke("move_clip", {
            itemId: ds.itemId,
            newStartUs,
          });
          setTimeline(tl);
        } catch (err) {
          console.error("move_clip failed:", err);
        }
      }
      return;
    }

    if (ts) {
      const dx = e.clientX - ts.startMouseX;
      const deltaUs = pixelsToUs(dx, pixelsPerSecond);
      const newUs = Math.max(0, Math.round(ts.originalUs + deltaUs));
      setTrimStateValue(null);
      if (Math.abs(dx) < 3) return;
      try {
        const tl = await invoke("trim_clip", {
          itemId: ts.itemId,
          trimType: ts.edge === "left" ? "in" : "out",
          newUs,
        });
        setTimeline(tl);
      } catch (err) {
        console.error("trim_clip failed:", err);
      }
      return;
    }
  };

  // --- Global mouse move: snap-line preview and drop-target highlight ---
  const handleGlobalMouseMoveRef = useRef<(e: MouseEvent) => void>(() => {});
  handleGlobalMouseMoveRef.current = (e: MouseEvent) => {
    const ds = dragStateRef.current;
    if (!ds) {
      if (snapLineUs !== null) setSnapLineUs(null);
      if (dragTargetTrackId !== null) setDragTargetTrackId(null);
      return;
    }

    const targetTrack = getTrackAtY(e.clientY);
    if (targetTrack && targetTrack.id !== ds.trackId && targetTrack.kind === ds.trackKind) {
      setDragTargetTrackId(targetTrack.id);
    } else {
      setDragTargetTrackId(null);
    }

    if (!snapping) {
      if (snapLineUs !== null) setSnapLineUs(null);
      return;
    }

    const dx = e.clientX - ds.startMouseX;
    const deltaUs = pixelsToUs(dx, pixelsPerSecond);
    const pos = Math.max(0, Math.round(ds.originalStartUs + deltaUs));

    if (!snapPointsCacheRef.current) {
      invoke("get_snap_points", { excludeItemId: ds.itemId })
        .then((pts) => { snapPointsCacheRef.current = pts; })
        .catch(() => {});
      return;
    }

    const thresholdUs = Math.round(pixelsToUs(5, pixelsPerSecond));
    setSnapLineUs(nearestSnapPoint(pos, snapPointsCacheRef.current, thresholdUs));
  };

  // --- Ruler scrub ---
  const handleRulerMouseMoveRef = useRef<(e: MouseEvent) => void>(() => {});
  handleRulerMouseMoveRef.current = (e: MouseEvent) => {
    if (!rulerDraggingRef.current) return;
    if (playing) onPlayingChange(false);
    onPlayheadChange(calcPlayheadFromClientX(e.clientX));
  };

  useEffect(() => {
    const upHandler = (e: MouseEvent) => {
      handleGlobalMouseUpRef.current(e);
      rulerDraggingRef.current = false;
    };
    const moveHandler = (e: MouseEvent) => {
      handleGlobalMouseMoveRef.current(e);
      handleRulerMouseMoveRef.current(e);
    };
    window.addEventListener("mouseup", upHandler);
    window.addEventListener("mousemove", moveHandler);
    return () => {
      window.removeEventListener("mouseup", upHandler);
      window.removeEventListener("mousemove", moveHandler);
    };
  }, []);

  const handleRulerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    rulerDraggingRef.current = true;
    if (playing) onPlayingChange(false);
    onPlayheadChange(calcPlayheadFromClientX(e.clientX));
  };

  const handleClipMouseDown = (
    e: React.MouseEvent,
    itemId: string,
    startUs: number,
    trackId: string,
    trackKind: string,
  ) => {
    if ((e.target as HTMLElement).classList.contains("trim-handle")) return;
    e.stopPropagation();
    onSelectClip(itemId);
    snapPointsCacheRef.current = null;
    setDragStateValue({
      itemId,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      originalStartUs: startUs,
      trackId,
      trackKind,
    });
  };

  const handleTrimMouseDown = (
    e: React.MouseEvent,
    itemId: string,
    edge: "left" | "right",
    currentUs: number,
  ) => {
    e.stopPropagation();
    onSelectClip(itemId);
    setTrimStateValue({ itemId, edge, startMouseX: e.clientX, originalUs: currentUs });
  };

  return {
    dragState,
    trimState,
    dragTargetTrackId,
    snapLineUs,
    handleRulerMouseDown,
    handleClipMouseDown,
    handleTrimMouseDown,
  };
}
