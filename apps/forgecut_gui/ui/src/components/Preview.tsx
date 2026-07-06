import { useState, useEffect, useRef, useCallback } from "react";
import { invoke, mediaUrl } from "../lib/bridge";
import type { ClipAtPlayhead, OverlayData, PreviewProps } from "../lib/preview/types";
import {
  sourceTimeToPlayheadUs,
  formatTimeUs,
} from "../lib/preview/time-utils";

export default function Preview(props: PreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [statusMsg, setStatusMsg] = useState("Import a clip and drag it to the timeline");
  const [overlays, setOverlays] = useState<OverlayData[]>([]);

  const pb = useRef({
    currentClip: null as ClipAtPlayhead | null,
    currentFilePath: "",
    pollInterval: undefined as number | undefined,
  });

  const stopPolling = useCallback(() => {
    clearInterval(pb.current.pollInterval);
    pb.current.pollInterval = undefined;
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // --- Seek effect: when paused, load clip + seek video ---
  useEffect(() => {
    if (props.playing) return;

    stopPolling();

    let cancelled = false;

    invoke<ClipAtPlayhead | null>("get_clip_at_playhead", { playheadUs: props.playheadUs })
      .then(async (clip) => {
        if (cancelled) return;
        const video = videoRef.current;
        if (!video) return;

        if (!clip) {
          setStatusMsg("No clip at playhead");
          video.removeAttribute("src");
          loadVideo(video);
          pb.current.currentClip = null;
          pb.current.currentFilePath = "";
          return;
        }

        pb.current.currentClip = clip;

        if (clip.file_path !== pb.current.currentFilePath) {
          video.src = mediaUrl(clip.file_path);
          loadVideo(video);
          pb.current.currentFilePath = clip.file_path;
          await waitForMetadata(video);
          if (cancelled) return;
        }

        video.currentTime = clip.seek_seconds;
        video.pause();
        if (cancelled) return;
        setStatusMsg("");
      })
      .catch((e) => {
        if (!cancelled) setStatusMsg(`Error: ${e}`);
      });

    invoke<OverlayData[]>("get_overlays_at_time", { playheadUs: props.playheadUs })
      .then((r) => { if (!cancelled) setOverlays(r); })
      .catch(() => { if (!cancelled) setOverlays([]); });

    return () => { cancelled = true; };
  }, [props.playing, props.playheadUs, stopPolling]);

  // --- Polling: sync playhead to video position during playback ---
  const startPolling = useCallback(() => {
    stopPolling();
    pb.current.pollInterval = window.setInterval(() => {
      const clip = pb.current.currentClip;
      const video = videoRef.current;
      if (!clip || !video) return;

      try {
        const timelineUs = sourceTimeToPlayheadUs(
          video.currentTime, clip.clip_start_us, clip.source_in_us
        );

        if (timelineUs >= clip.clip_end_us) {
          video.pause();
          stopPolling();
          props.onPlayingChange(false);
          props.onPlayheadChange(clip.clip_end_us);
          return;
        }

        props.onPlayheadChange(Math.round(Math.max(0, timelineUs)));
      } catch {
        // video might not have a file loaded yet
      }
    }, 30);
  }, [stopPolling, props.onPlayingChange, props.onPlayheadChange]);

  const handlePlayPause = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    if (props.playing) {
      video.pause();
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
        video.src = mediaUrl(clip.file_path);
        loadVideo(video);
        pb.current.currentFilePath = clip.file_path;
        await waitForMetadata(video);
      }
      video.currentTime = clip.seek_seconds;
      await video.play();
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
      <div className="preview-viewport">
        <video
          ref={videoRef}
          className="preview-video"
          playsInline
          onEnded={() => {
            stopPolling();
            props.onPlayingChange(false);
            if (pb.current.currentClip) {
              props.onPlayheadChange(pb.current.currentClip.clip_end_us);
            }
          }}
        />
        {overlays.map((overlay, i) => {
          if (overlay.ImageOverlay) {
            const img = overlay.ImageOverlay;
            return (
              <img
                key={i}
                src={mediaUrl(img.file_path)}
                style={{
                  position: "absolute",
                  left: `${img.x}px`,
                  top: `${img.y}px`,
                  width: `${img.width}px`,
                  height: `${img.height}px`,
                  opacity: img.opacity,
                  pointerEvents: "none",
                  objectFit: "contain",
                }}
              />
            );
          }

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

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  if (Number.isFinite(video.duration) && video.readyState >= 1) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Failed to load video"));
    };
    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function loadVideo(video: HTMLVideoElement): void {
  if (navigator.userAgent.includes("jsdom")) return;
  video.load();
}
