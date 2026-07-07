import { useEffect, useRef } from "react";
import { invoke } from "../lib/bridge";
import type { Timeline } from "../lib/timeline/items";

export interface TimelineShortcutOptions {
  selectedClipId: string | null;
  playheadUs: number;
  setTimeline: (timeline: Timeline) => void;
  onSelectClip: (id: string | null) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitAll: () => void;
}

/**
 * Global keyboard shortcuts: undo/redo, zoom, fit, delete, split.
 * The handler is kept in a ref reassigned each render to avoid stale closures.
 */
export function useTimelineShortcuts(options: TimelineShortcutOptions) {
  const handleKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});
  handleKeyDownRef.current = async (e: KeyboardEvent) => {
    // Undo: Ctrl+Z
    if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault();
      try {
        options.setTimeline(await invoke("undo"));
      } catch (_) {}
      return;
    }

    // Redo: Ctrl+Shift+Z
    if (e.key === "Z" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      try {
        options.setTimeline(await invoke("redo"));
      } catch (_) {}
      return;
    }

    // Zoom shortcuts
    if ((e.key === "=" || e.key === "+") && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      options.zoomIn();
      return;
    }
    if (e.key === "-" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      options.zoomOut();
      return;
    }
    if (e.key === "0" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      options.fitAll();
      return;
    }

    const sel = options.selectedClipId;
    if (!sel) return;

    // Delete selected clip
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      try {
        options.setTimeline(await invoke("delete_clip", { itemId: sel }));
        options.onSelectClip(null);
      } catch (err) {
        console.error("delete_clip failed:", err);
      }
      return;
    }

    // Split at playhead
    if ((e.key === "s" || e.key === "S") && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      try {
        options.setTimeline(
          await invoke("split_clip", { itemId: sel, splitTimeUs: options.playheadUs }),
        );
      } catch (err) {
        console.error("split_clip failed:", err);
      }
      return;
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => handleKeyDownRef.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
