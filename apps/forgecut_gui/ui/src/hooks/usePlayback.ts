import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, mediaUrl } from "../lib/bridge";
import type { ClipAtPlayhead, OverlayData } from "../lib/preview/types";
import { sourceTimeToPlayheadUs } from "../lib/preview/time-utils";
import { loadVideo, seekVideo, waitForMetadata } from "../lib/preview/video-element";

const POLL_INTERVAL_MS = 30;

export interface PlaybackOptions {
  playheadUs: number;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  onPlayheadChange: (us: number) => void;
}

/**
 * Drives the preview <video> element from the timeline playhead:
 * - paused: resolve the clip under the playhead over IPC and seek to it
 * - playing: poll the element and push its position back to the playhead
 */
export function usePlayback(options: PlaybackOptions) {
  const { playheadUs, playing, onPlayingChange, onPlayheadChange } = options;

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

  /** Point the element at a clip's file and seek to the clip-relative time. */
  const showClip = useCallback(async (video: HTMLVideoElement, clip: ClipAtPlayhead) => {
    pb.current.currentClip = clip;
    if (clip.file_path !== pb.current.currentFilePath) {
      video.src = mediaUrl(clip.file_path);
      loadVideo(video);
      pb.current.currentFilePath = clip.file_path;
      await waitForMetadata(video);
    }
    await seekVideo(video, clip.seek_seconds);
  }, []);

  // --- Seek effect: when paused, load clip + seek video ---
  useEffect(() => {
    if (playing) return;

    stopPolling();

    let cancelled = false;

    (async () => {
      try {
        const clip = await invoke("get_clip_at_playhead", { playheadUs });
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

        await seekVideo(video, clip.seek_seconds);
        if (cancelled) return;
        video.pause();
        setStatusMsg("");
      } catch (e) {
        if (!cancelled) setStatusMsg(`Error: ${e}`);
      }
    })();

    invoke("get_overlays_at_time", { playheadUs })
      .then((r) => { if (!cancelled) setOverlays(r); })
      .catch(() => { if (!cancelled) setOverlays([]); });

    return () => { cancelled = true; };
  }, [playing, playheadUs, stopPolling]);

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
          onPlayingChange(false);
          onPlayheadChange(clip.clip_end_us);
          return;
        }

        onPlayheadChange(Math.round(Math.max(0, timelineUs)));
      } catch {
        // video might not have a file loaded yet
      }
    }, POLL_INTERVAL_MS);
  }, [stopPolling, onPlayingChange, onPlayheadChange]);

  const handlePlayPause = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    if (playing) {
      video.pause();
      stopPolling();
      onPlayingChange(false);
      return;
    }

    let clip: ClipAtPlayhead | null;
    try {
      clip = await invoke("get_clip_at_playhead", { playheadUs });
    } catch (e) {
      setStatusMsg(`Error: ${e}`);
      return;
    }

    if (!clip) {
      setStatusMsg("No clip at playhead");
      return;
    }

    try {
      await showClip(video, clip);
      await video.play();
      onPlayingChange(true);
      setStatusMsg("");
      startPolling();
    } catch (e) {
      setStatusMsg(`Play error: ${e}`);
      onPlayingChange(false);
    }
  }, [playing, playheadUs, onPlayingChange, stopPolling, startPolling, showClip]);

  const handleEnded = useCallback(() => {
    stopPolling();
    onPlayingChange(false);
    if (pb.current.currentClip) {
      onPlayheadChange(pb.current.currentClip.clip_end_us);
    }
  }, [stopPolling, onPlayingChange, onPlayheadChange]);

  return { videoRef, statusMsg, overlays, handlePlayPause, handleEnded };
}
