import type { TimelineItem } from "../shared/ipc-contract.js";

export function audioEnvelope(item: TimelineItem, durationUs: number) {
  const music = "AudioClip" in item;
  const clip = music
    ? item.AudioClip
    : "VideoClip" in item
      ? item.VideoClip
      : null;
  const defaultFade = music ? 100000 : 0;
  return {
    volume: clip?.muted ? 0 : (clip?.volume ?? 1),
    fadeInUs: Math.min(durationUs, clip?.fade_in_us ?? defaultFade),
    fadeOutUs: Math.min(durationUs, clip?.fade_out_us ?? defaultFade),
  };
}

export function audioGainAt(
  item: TimelineItem,
  elapsedUs: number,
  durationUs: number,
): number {
  const envelope = audioEnvelope(item, durationUs);
  const fadeIn = envelope.fadeInUs
    ? Math.min(1, elapsedUs / envelope.fadeInUs)
    : 1;
  const fadeOut = envelope.fadeOutUs
    ? Math.min(1, (durationUs - elapsedUs) / envelope.fadeOutUs)
    : 1;
  return envelope.volume * Math.max(0, fadeIn) * Math.max(0, fadeOut);
}
