import { useSyncExternalStore } from "react";

/**
 * The playhead changes every frame during playback, so it lives outside React
 * state: only the views that draw it subscribe, and everything else reads it
 * when it acts.
 */
export type Playhead = {
  get: () => number;
  set: (timeUs: number) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createPlayhead(initialUs = 0): Playhead {
  let current = initialUs;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (timeUs) => {
      if (timeUs === current) return;
      current = timeUs;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function usePlayheadUs(playhead: Playhead): number {
  return useSyncExternalStore(playhead.subscribe, playhead.get);
}
