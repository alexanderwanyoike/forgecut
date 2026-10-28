export type MediaSyncState = {
  readyState: number;
  currentTime: number;
  /** Still reading the source; Matroska index reads may be in flight after loadeddata. */
  loading: boolean;
  seekPending: boolean;
};

export type MediaSync =
  { wait: true } | { wait: false; seekTo?: number; presentable: boolean };

/** What a preview source must do to show `targetSeconds`. */
export function mediaSync(
  state: MediaSyncState,
  targetSeconds: number,
  precise: boolean,
): MediaSync {
  if (state.readyState < 1) return { wait: true };
  // Playing sources run on their own decoder clock; seeking for small drift drops frames.
  const tolerance = precise ? 0.001 : 0.15;
  const seek = Math.abs(state.currentTime - targetSeconds) > tolerance;
  if (seek && (state.readyState < 2 || state.loading)) return { wait: true };
  return {
    wait: false,
    seekTo: seek ? targetSeconds : undefined,
    // A fresh element shows its first decoded frame, not the requested one, until our seek lands.
    presentable: !seek && !state.seekPending && state.readyState >= 2,
  };
}
