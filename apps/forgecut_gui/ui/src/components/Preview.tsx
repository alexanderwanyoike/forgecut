import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ClipAtPlayhead, OverlayData, PreviewProps } from "../lib/preview/types";
import {
  sourceTimeToPlayheadUs,
  formatTimeUs,
} from "../lib/preview/time-utils";

/** Compute the viewport's position and size in physical pixels,
 *  relative to the parent window's content area (for X11 child window). */
async function getViewportRect(el: HTMLElement): Promise<{
  x: number;
  y: number;
  w: number;
  h: number;
}> {
  const scaleFactor = await getCurrentWindow().scaleFactor();
  const rect = el.getBoundingClientRect();

  return {
    x: Math.round(rect.left * scaleFactor),
    y: Math.round(rect.top * scaleFactor),
    w: Math.round(rect.width * scaleFactor),
    h: Math.round(rect.height * scaleFactor),
  };
}

export default function Preview(props: PreviewProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [statusMsg, setStatusMsg] = useState("Import a clip and drag it to the timeline");
  const [overlays, setOverlays] = useState<OverlayData[]>([]);

  const pb = useRef({
    currentClip: null as ClipAtPlayhead | null,
    currentFilePath: "",
    pollInterval: undefined as number | undefined,
    mpvStarted: false,
  });

  const stopPolling = useCallback(() => {
    clearInterval(pb.current.pollInterval);
    pb.current.pollInterval = undefined;
  }, []);

  // --- Mount: start mpv embedded, cleanup on unmount ---
  useEffect(() => {
    let cancelled = false;

    const startMpv = async () => {
      const el = viewportRef.current;
      if (!el) return;
      try {
        const rect = await getViewportRect(el);
        await invoke("mpv_start", rect);
        if (!cancelled) pb.current.mpvStarted = true;
      } catch (e) {
        if (!cancelled) setStatusMsg(`mpv start error: ${e}`);
      }
    };

    startMpv();

    return () => {
      cancelled = true;
      stopPolling();
      invoke("mpv_stop").catch(() => {});
      pb.current.mpvStarted = false;
    };
  }, [stopPolling]);

  // --- Geometry sync: keep mpv child window aligned with viewport ---
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    let rafId = 0;
    const syncGeometry = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(async () => {
        if (!pb.current.mpvStarted) return;
        try {
          const rect = await getViewportRect(el);
          await invoke("mpv_update_geometry", rect);
        } catch {}
      });
    };

    const resizeObserver = new ResizeObserver(syncGeometry);
    resizeObserver.observe(el);

    const win = getCurrentWindow();
    const unlistenMoved = win.onMoved(syncGeometry);
    const unlistenResized = win.onResized(syncGeometry);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      unlistenMoved.then((f) => f());
      unlistenResized.then((f) => f());
    };
  }, []);

  // --- Seek effect: when paused, load clip + seek mpv ---
  useEffect(() => {
    if (props.playing) return;

    stopPolling();

    let cancelled = false;

    invoke<ClipAtPlayhead | null>("get_clip_at_playhead", { playheadUs: props.playheadUs })
      .then(async (clip) => {
        if (cancelled) return;
        if (!clip) {
          setStatusMsg("No clip at playhead");
          return;
        }
        pb.current.currentClip = clip;

        if (clip.file_path !== pb.current.currentFilePath) {
          await invoke("mpv_load_file", { path: clip.file_path });
          if (cancelled) return;
          pb.current.currentFilePath = clip.file_path;
          // Give mpv a moment to load the file before seeking
          await new Promise((r) => setTimeout(r, 50));
          if (cancelled) return;
        }

        await invoke("mpv_seek", { seconds: clip.seek_seconds });
        if (cancelled) return;
        await invoke("mpv_pause");
        if (cancelled) return;
        setStatusMsg("");
      })
      .catch((e) => {
        if (!cancelled) setStatusMsg(`Error: ${e}`);
      });

    // Fetch overlays
    invoke<OverlayData[]>("get_overlays_at_time", { playheadUs: props.playheadUs })
      .then((r) => { if (!cancelled) setOverlays(r); })
      .catch(() => { if (!cancelled) setOverlays([]); });

    return () => { cancelled = true; };
  }, [props.playing, props.playheadUs, stopPolling]);

  // --- Polling: sync playhead to mpv position during playback ---
  const startPolling = useCallback(() => {
    stopPolling();
    pb.current.pollInterval = window.setInterval(async () => {
      const clip = pb.current.currentClip;
      if (!clip) return;

      try {
        const posSec = await invoke<number>("mpv_get_position");
        const timelineUs = sourceTimeToPlayheadUs(
          posSec, clip.clip_start_us, clip.source_in_us
        );

        if (timelineUs >= clip.clip_end_us) {
          await invoke("mpv_pause");
          stopPolling();
          props.onPlayingChange(false);
          props.onPlayheadChange(clip.clip_end_us);
          return;
        }

        props.onPlayheadChange(Math.round(Math.max(0, timelineUs)));
      } catch {
        // mpv might not have a file loaded yet
      }
    }, 30);
  }, [stopPolling, props.onPlayingChange, props.onPlayheadChange]);

  // --- Play/Pause button ---
  const handlePlayPause = useCallback(async () => {
    if (props.playing) {
      await invoke("mpv_pause").catch(() => {});
      stopPolling();
      props.onPlayingChange(false);
      return;
    }

    let clip: ClipAtPlayhead | null;
    try {
      clip = await invoke<ClipAtPlayhead | null>("get_clip_at_playhead", {
        playheadUs: props.playheadUs,
      });
    } catch (e) {
      setStatusMsg(`Error: ${e}`);
      return;
    }

    if (!clip) {
      setStatusMsg("No clip at playhead");
      return;
    }

    pb.current.currentClip = clip;

    try {
      if (clip.file_path !== pb.current.currentFilePath) {
        await invoke("mpv_load_file", { path: clip.file_path });
        pb.current.currentFilePath = clip.file_path;
        await new Promise((r) => setTimeout(r, 50));
      }
      await invoke("mpv_seek", { seconds: clip.seek_seconds });
      await invoke("mpv_resume");
      props.onPlayingChange(true);
      setStatusMsg("");
      startPolling();
    } catch (e) {
      setStatusMsg(`Play error: ${e}`);
      props.onPlayingChange(false);
    }
  }, [props.playing, props.playheadUs, props.onPlayingChange, stopPolling, startPolling]);

  return (
    <section className="panel preview">
      <div className="preview-viewport" ref={viewportRef}>
        {overlays.map((overlay, i) => {
          if (overlay.TextOverlay) {
            const txt = overlay.TextOverlay;
            return (
              <span
                key={i}
                style={{
                  position: "absolute",
                  left: `${txt.x}px`,
                  top: `${txt.y}px`,
                  fontSize: `${txt.font_size}px`,
                  color: txt.color,
                  pointerEvents: "none",
                  textShadow: "0 1px 3px rgba(0,0,0,0.7)",
                  whiteSpace: "nowrap",
                }}
              >
                {txt.text}
              </span>
            );
          }
          return null;
        })}
        {statusMsg && (
          <span className="placeholder-label">{statusMsg}</span>
        )}
      </div>
      <div className="preview-controls">
        <button className="preview-btn" onClick={handlePlayPause}>
          {props.playing ? "\u23F9" : "\u25B6"}
        </button>
        <span className="preview-time">{formatTimeUs(props.playheadUs)}</span>
      </div>
    </section>
  );
}
