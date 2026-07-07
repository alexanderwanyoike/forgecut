import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "../lib/bridge";
import { getItemData, type Timeline } from "../lib/timeline/items";

export type ThumbnailView = { time_seconds: number; url: string };

/**
 * Caches per-asset thumbnails and waveforms for the clips currently on the
 * timeline, and invalidates the caches when the project changes.
 */
export function useClipMedia(timeline: Timeline, projectVersion: number) {
  // asset_id -> [min, max] peak pairs
  const [waveforms, setWaveforms] = useState<Record<string, number[][]>>({});
  // asset_id -> thumbnail strip
  const [thumbnails, setThumbnails] = useState<Record<string, ThumbnailView[]>>({});
  // reactive loading flags (drives the shimmer UI)
  const [thumbnailsLoading, setThumbnailsLoading] = useState<Record<string, boolean>>({});
  // in-flight guard to avoid duplicate fetches
  const thumbnailsLoadingRef = useRef<Record<string, boolean>>({});

  const fetchWaveform = useCallback(async (assetId: string) => {
    if (waveforms[assetId]) return;
    try {
      const data = await invoke("get_waveform", { assetId });
      setWaveforms((prev) => ({ ...prev, [assetId]: data.peaks }));
    } catch (_) {
      // Waveform extraction may fail for non-audio files; silently ignore
    }
  }, [waveforms]);

  const fetchThumbnails = useCallback(async (assetId: string) => {
    if (thumbnails[assetId] || thumbnailsLoadingRef.current[assetId]) return;
    thumbnailsLoadingRef.current[assetId] = true;
    setThumbnailsLoading((prev) => ({ ...prev, [assetId]: true }));
    try {
      const data = await invoke("get_clip_thumbnails", { assetId });
      const mapped = data.map((t) => ({ time_seconds: t.time_seconds, url: t.data_uri }));
      setThumbnails((prev) => ({ ...prev, [assetId]: mapped }));
    } catch (_) {
    } finally {
      thumbnailsLoadingRef.current[assetId] = false;
      setThumbnailsLoading((prev) => ({ ...prev, [assetId]: false }));
    }
  }, [thumbnails]);

  // Fetch media for clips whenever the timeline changes
  useEffect(() => {
    for (const track of timeline.tracks) {
      for (const item of track.items) {
        const data = getItemData(item);
        if (track.kind === "Video" && data.variant === "VideoClip" && data.asset_id) {
          fetchThumbnails(data.asset_id);
        }
        if (track.kind === "Audio" && data.variant === "AudioClip" && data.asset_id) {
          fetchWaveform(data.asset_id);
        }
      }
    }
  }, [timeline, fetchThumbnails, fetchWaveform]);

  // Clear stale caches when the project changes
  useEffect(() => {
    if (projectVersion === 0) return;
    setThumbnails({});
    setWaveforms({});
    setThumbnailsLoading({});
    thumbnailsLoadingRef.current = {};
  }, [projectVersion]);

  return { waveforms, thumbnails, thumbnailsLoading };
}
