import { createSignal, createEffect, onCleanup, onMount, Show, For } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

interface ClipAtPlayhead {
  file_path: string;
  seek_seconds: number;
  clip_start_us: number;
  clip_end_us: number;
  source_in_us: number;
}

interface OverlayData {
  ImageOverlay?: {
    file_path: string;
    x: number;
    y: number;
    width: number;
    height: number;
    opacity: number;
  };
  TextOverlay?: {
    text: string;
    font_size: number;
    color: string;
    x: number;
    y: number;
  };
}

interface PreviewProps {
  playheadUs: number;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  onPlayheadChange: (us: number) => void;
}

export default function Preview(props: PreviewProps) {
  let videoRef: HTMLVideoElement | undefined;
  let pollInterval: number | undefined;
  let currentClip: ClipAtPlayhead | null = null;
  let currentFilePath = "";
  const [statusMsg, setStatusMsg] = createSignal("Import a clip and drag it to the timeline");
  const [overlays, setOverlays] = createSignal<OverlayData[]>([]);
  const [mediaPort, setMediaPort] = createSignal(0);

  onMount(async () => {
    try {
      const port = await invoke<number>("get_media_port");
      setMediaPort(port);
      console.log("[Preview] media server port:", port);
    } catch (e) {
      console.error("[Preview] failed to get media port:", e);
    }
  });

  // Fetch overlays whenever playhead changes
  createEffect(async () => {
    const playhead = props.playheadUs;
    try {
      const result = await invoke<OverlayData[]>("get_overlays_at_time", {
        playheadUs: playhead,
      });
      setOverlays(result);
    } catch {
      setOverlays([]);
    }
  });

  const mediaUrl = (filePath: string): string => {
    return `http://127.0.0.1:${mediaPort()}/${encodeURIComponent(filePath)}`;
  };

  const handlePlayPause = async () => {
    if (props.playing) {
      videoRef?.pause();
      stopPolling();
      props.onPlayingChange(false);
      return;
    }

    if (!mediaPort()) {
      setStatusMsg("Media server not ready");
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

    console.log("[Preview] playing:", clip.file_path, "seek:", clip.seek_seconds);
    currentClip = clip;

    if (!videoRef) return;

    const url = mediaUrl(clip.file_path);

    if (currentFilePath !== clip.file_path) {
      currentFilePath = clip.file_path;
      setStatusMsg("Loading...");
      videoRef.src = url;

      videoRef.onloadedmetadata = () => {
        console.log("[Preview] metadata loaded, duration:", videoRef!.duration);
        videoRef!.currentTime = clip!.seek_seconds;
        videoRef!.play().then(() => {
          console.log("[Preview] playing");
          setStatusMsg("");
          props.onPlayingChange(true);
          startPolling();
        }).catch((e) => {
          console.error("[Preview] play() rejected:", e);
          setStatusMsg(`Play error: ${e}`);
        });
      };

      videoRef.onerror = () => {
        const err = videoRef!.error;
        console.error("[Preview] video error:", err?.code, err?.message);
        setStatusMsg(`Video error (code ${err?.code}): ${err?.message || "unknown"}`);
      };

      videoRef.load();
    } else {
      videoRef.currentTime = clip.seek_seconds;
      videoRef.play().then(() => {
        setStatusMsg("");
        props.onPlayingChange(true);
        startPolling();
      }).catch((e) => {
        setStatusMsg(`Play error: ${e}`);
      });
    }
  };

  const startPolling = () => {
    stopPolling();
    pollInterval = window.setInterval(() => {
      if (!videoRef || !currentClip) return;
      if (videoRef.paused || videoRef.ended) {
        stopPolling();
        props.onPlayingChange(false);
        return;
      }

      const sourceUs = videoRef.currentTime * 1_000_000;
      const sourceOffsetUs = sourceUs - currentClip.source_in_us;
      const timelineUs = currentClip.clip_start_us + sourceOffsetUs;

      if (timelineUs >= currentClip.clip_end_us) {
        videoRef.pause();
        stopPolling();
        props.onPlayingChange(false);
        props.onPlayheadChange(currentClip.clip_end_us);
        return;
      }
      props.onPlayheadChange(Math.round(Math.max(0, timelineUs)));
    }, 30);
  };

  const stopPolling = () => {
    if (pollInterval !== undefined) {
      clearInterval(pollInterval);
      pollInterval = undefined;
    }
  };

  onCleanup(() => stopPolling());

  const formatTime = (us: number): string => {
    const totalMs = Math.floor(Math.abs(us) / 1000);
    const ms = totalMs % 1000;
    const totalSec = Math.floor(totalMs / 1000);
    const sec = totalSec % 60;
    const min = Math.floor(totalSec / 60) % 60;
    const hr = Math.floor(totalSec / 3600);
    return `${hr.toString().padStart(2, "0")}:${min
      .toString()
      .padStart(2, "0")}:${sec.toString().padStart(2, "0")}.${ms
      .toString()
      .padStart(3, "0")}`;
  };

  return (
    <section class="panel preview">
      <div class="preview-viewport">
        <video ref={videoRef} class="preview-video" preload="metadata" />
        <For each={overlays()}>
          {(overlay) => {
            if (overlay.TextOverlay) {
              const txt = overlay.TextOverlay;
              return (
                <span
                  style={{
                    position: "absolute",
                    left: `${txt.x}px`,
                    top: `${txt.y}px`,
                    "font-size": `${txt.font_size}px`,
                    color: txt.color,
                    "pointer-events": "none",
                    "text-shadow": "0 1px 3px rgba(0,0,0,0.7)",
                    "white-space": "nowrap",
                  }}
                >
                  {txt.text}
                </span>
              );
            }
            return null;
          }}
        </For>
        <Show when={statusMsg()}>
          <span class="placeholder-label">{statusMsg()}</span>
        </Show>
      </div>
      <div class="preview-controls">
        <button class="preview-btn" onClick={handlePlayPause}>
          {props.playing ? "\u23F9" : "\u25B6"}
        </button>
        <span class="preview-time">{formatTime(props.playheadUs)}</span>
      </div>
    </section>
  );
}
