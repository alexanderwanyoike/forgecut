import { useEffect, useRef, useState } from "react";
import { invoke } from "../lib/bridge";
import { getItemData, type Timeline } from "../lib/timeline/items";

export type ThumbnailView = { time_seconds: number; url: string };

export function useClipMedia(timeline: Timeline, mediaVersion: number | string) {
  const [waveforms, setWaveforms] = useState<Record<string, number[][]>>({});
  const [thumbnails, setThumbnails] = useState<Record<string, ThumbnailView[]>>({});
  const [thumbnailsLoading, setThumbnailsLoading] = useState<Record<string, boolean>>({});
  const generation = useRef(0);
  const requested = useRef(new Set<string>());

  useEffect(() => {
    generation.current += 1;
    requested.current.clear();
    setThumbnails({});
    setWaveforms({});
    setThumbnailsLoading({});
    return () => { generation.current += 1; };
  }, [mediaVersion]);

  useEffect(() => {
    const epoch = generation.current;
    for (const track of timeline.tracks) {
      for (const item of track.items) {
        const data = getItemData(item);
        if (!data.asset_id) continue;
        const assetId = data.asset_id;
        const key = `${data.variant}:${assetId}`;
        if (requested.current.has(key)) continue;
        if (data.variant === "VideoClip") {
          requested.current.add(key);
          setThumbnailsLoading((current) => ({ ...current, [assetId]: true }));
          invoke("get_clip_thumbnails", { assetId }).then((values) => {
            if (generation.current === epoch) setThumbnails((current) => ({ ...current, [assetId]: values.map((value) => ({ time_seconds: value.time_seconds, url: value.data_uri })) }));
          }).catch(() => {}).finally(() => {
            if (generation.current === epoch) setThumbnailsLoading((current) => ({ ...current, [assetId]: false }));
          });
        } else if (data.variant === "AudioClip") {
          requested.current.add(key);
          invoke("get_waveform", { assetId }).then((value) => {
            if (generation.current === epoch) setWaveforms((current) => ({ ...current, [assetId]: value.peaks }));
          }).catch(() => {});
        }
      }
    }
  }, [timeline, mediaVersion]);

  return { waveforms, thumbnails, thumbnailsLoading };
}
