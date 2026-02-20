import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ClipAtPlayhead, OverlayData, PreviewProps } from "../lib/preview/types";
import {
  usToSeconds,
  sourceTimeToPlayheadUs,
  formatTimeUs,
  buildMediaUrl,
} from "../lib/preview/time-utils";
import { SeekController } from "../lib/preview/seek-controller";

export default function Preview(props: PreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const currentClipRef = useRef<ClipAtPlayhead | null>(null);
  const currentFilePathRef = useRef("");
  const playheadDrivenByVideoRef = useRef(false);
  const pollIntervalRef = useRef<number | undefined>(undefined);
  const seekControllerRef = useRef(new SeekController());

  const [mediaPort, setMediaPort] = useState<number>(0);
  const [statusMsg, setStatusMsg] = useState(
    "Import a clip and drag it to the timeline"
  );
  const [overlays, setOverlays] = useState<OverlayData[]>([]);

  // Fetch overlays whenever playhead changes
  useEffect(() => {
    invoke<OverlayData[]>("get_overlays_at_time", {
      playheadUs: props.playheadUs,
    })
      .then(setOverlays)
      .catch(() => setOverlays([]));
  }, [props.playheadUs]);

  // Mount: attach seek controller, get media port
  useEffect(() => {
    if (videoRef.current) {
      seekControllerRef.current.attach(videoRef.current);
    }

    invoke<number>("get_media_port")
      .then(setMediaPort)
      .catch((e) => setStatusMsg(`Failed to get media port: ${e}`));

    return () => {
      stopPolling();
      stopAudio();
      seekControllerRef.current.detach();
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, []);

  const ensureAudioContext = (): AudioContext => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext({ sampleRate: 48000 });
    }
    return audioCtxRef.current;
  };

  /** Load a video source, waiting until the element is ready */
  const loadVideoSource = (filePath: string): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      if (!videoRef.current) {
        reject(new Error("No video element"));
        return;
      }
      if (filePath === currentFilePathRef.current) {
        resolve();
        return;
      }
      seekControllerRef.current.reset();
      const url = buildMediaUrl(mediaPort, filePath);
      const vid = videoRef.current;
      const onLoaded = () => {
        vid.removeEventListener("loadeddata", onLoaded);
        vid.removeEventListener("error", onError);
        currentFilePathRef.current = filePath;
        resolve();
      };
      const onError = () => {
        vid.removeEventListener("loadeddata", onLoaded);
        vid.removeEventListener("error", onError);
        reject(new Error("Video load error"));
      };
      vid.addEventListener("loadeddata", onLoaded);
      vid.addEventListener("error", onError);
      vid.src = url;
    });
  };

  // --- Polling for playhead sync during playback ---
  const startPolling = () => {
    stopPolling();
    pollIntervalRef.current = window.setInterval(() => {
      if (!videoRef.current || !currentClipRef.current) return;
      if (!props.playing) return;

      const currentTimeSec = videoRef.current.currentTime;
      const timelineUs = sourceTimeToPlayheadUs(
        currentTimeSec,
        currentClipRef.current.clip_start_us,
        currentClipRef.current.source_in_us
      );

      // Stop at clip end
      if (timelineUs >= currentClipRef.current.clip_end_us) {
        videoRef.current.pause();
        stopAudio();
        stopPolling();
        playheadDrivenByVideoRef.current = false;
        props.onPlayingChange(false);
        props.onPlayheadChange(currentClipRef.current.clip_end_us);
        return;
      }

      playheadDrivenByVideoRef.current = true;
      props.onPlayheadChange(Math.round(Math.max(0, timelineUs)));
    }, 30);
  };

  const stopPolling = () => {
    if (pollIntervalRef.current !== undefined) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = undefined;
    }
  };

  const stopAudio = () => {
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
        audioSourceRef.current.disconnect();
      } catch {
        /* already stopped */
      }
      audioSourceRef.current = null;
    }
  };

  // Pause effect — reacts to playing prop
  useEffect(() => {
    if (!props.playing) {
      if (videoRef.current && !videoRef.current.paused) videoRef.current.pause();
      stopAudio();
      stopPolling();
      playheadDrivenByVideoRef.current = false;
    }
  }, [props.playing]);

  // Seek effect — ONLY depends on playheadUs and mediaPort
  // `playing` is NOT a dependency — read from prop directly inside
  useEffect(() => {
    // Skip if this change came from our own polling
    if (playheadDrivenByVideoRef.current) {
      playheadDrivenByVideoRef.current = false;
      return;
    }

    // Don't seek during playback (Timeline pauses before scrubbing)
    if (props.playing) return;

    if (!videoRef.current || !mediaPort) return;

    invoke<ClipAtPlayhead | null>("get_clip_at_playhead", { playheadUs: props.playheadUs })
      .then(async (clip) => {
        if (!clip) {
          setStatusMsg("No clip at playhead");
          return;
        }
        currentClipRef.current = clip;

        try {
          await loadVideoSource(clip.file_path);
          seekControllerRef.current.requestSeek(clip.seek_seconds);
          setStatusMsg("");
        } catch (e) {
          setStatusMsg(`Load error: ${e}`);
        }
      })
      .catch((e) => {
        setStatusMsg(`IPC error: ${e}`);
      });
  }, [props.playheadUs, mediaPort]);

  // --- Play/Pause ---
  const handlePlayPause = async () => {
    if (props.playing) {
      // Pause
      if (videoRef.current) videoRef.current.pause();
      stopAudio();
      stopPolling();
      playheadDrivenByVideoRef.current = false;
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

    currentClipRef.current = clip;
    if (!videoRef.current || !mediaPort) return;

    try {
      // Load source if needed
      await loadVideoSource(clip.file_path);

      // Seek to the right position and wait for it to complete
      seekControllerRef.current.reset();
      videoRef.current.currentTime = clip.seek_seconds;
      await new Promise<void>((resolve) => {
        const vid = videoRef.current!;
        const onSeeked = () => {
          vid.removeEventListener("seeked", onSeeked);
          resolve();
        };
        // If already at the right time, resolve immediately
        if (!vid.seeking) {
          resolve();
        } else {
          vid.addEventListener("seeked", onSeeked);
        }
      });

      // Start video playback immediately (don't wait for audio extraction)
      videoRef.current.muted = false;
      await videoRef.current.play();
      props.onPlayingChange(true);
      setStatusMsg("");

      // Start polling for playhead sync
      playheadDrivenByVideoRef.current = true;
      startPolling();

      // Extract and overlay separate audio track asynchronously
      startAudioAsync(clip);
    } catch (e) {
      setStatusMsg(`Play error: ${e}`);
      props.onPlayingChange(false);
    }
  };

  /** Extract and play audio via Web Audio API without blocking video playback */
  const startAudioAsync = async (clip: ClipAtPlayhead) => {
    try {
      const actx = ensureAudioContext();
      if (actx.state === "suspended") {
        await actx.resume();
      }

      const sourceInSec = usToSeconds(clip.source_in_us);
      const clipDurationSec = usToSeconds(clip.clip_end_us - clip.clip_start_us);
      const startSec = clip.seek_seconds;
      const durationSec = sourceInSec + clipDurationSec - startSec;

      const wavPath = await invoke<string>("extract_clip_audio", {
        filePath: clip.file_path,
        startSeconds: startSec,
        durationSeconds: durationSec,
      });

      // If playback was stopped while we were extracting, bail out
      if (!props.playing) return;

      const wavUrl = buildMediaUrl(mediaPort, wavPath);
      const response = await fetch(wavUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await actx.decodeAudioData(arrayBuffer);

      if (!props.playing) return;

      stopAudio();
      audioSourceRef.current = actx.createBufferSource();
      audioSourceRef.current.buffer = audioBuffer;
      audioSourceRef.current.connect(actx.destination);
      audioSourceRef.current.start(0, 0);

      // Mute video element since we have separate audio now
      if (videoRef.current) videoRef.current.muted = true;
    } catch {
      // Audio extraction failed — video plays with its own audio (already unmuted)
    }
  };

  return (
    <section className="panel preview">
      <div className="preview-viewport">
        <video
          ref={videoRef}
          className="preview-video"
          preload="auto"
          muted
          playsInline
        />
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
