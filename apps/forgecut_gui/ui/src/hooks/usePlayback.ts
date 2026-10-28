import { useCallback, useEffect, useRef, useState } from "react";
import { secondsToUs } from "../lib/preview/time-utils";

type PlaybackOptions = {
  projectVersion: number;
  durationUs: number;
  playheadUs: number;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  onPlayheadChange: (timeUs: number) => void;
  /** False while something on screen has nothing to show yet; the clock waits. */
  canAdvance?: () => boolean;
};

export function usePlayback(options: PlaybackOptions) {
  const [buffering, setBuffering] = useState(false);
  const latest = useRef(options);
  latest.current = options;
  const version = useRef(options.projectVersion);
  const clock = useRef({
    anchorMs: 0,
    anchorUs: 0,
    emittedUs: options.playheadUs,
  });
  const stable = version.current === options.projectVersion;

  useEffect(() => {
    if (version.current !== options.projectVersion) {
      version.current = options.projectVersion;
      latest.current.onPlayingChange(false);
      return undefined;
    }
    if (!options.playing) {
      setBuffering(false);
      return undefined;
    }
    clock.current = {
      anchorMs: performance.now(),
      anchorUs: options.playheadUs,
      emittedUs: options.playheadUs,
    };
    let request = 0;
    const tick = (now: number) => {
      const { current } = latest;
      if (current.canAdvance && !current.canAdvance()) {
        clock.current.anchorUs = clock.current.emittedUs;
        clock.current.anchorMs = now;
        setBuffering(true);
        request = requestAnimationFrame(tick);
        return;
      }
      setBuffering(false);
      const next = Math.min(
        current.durationUs,
        clock.current.anchorUs +
          secondsToUs((now - clock.current.anchorMs) / 1000),
      );
      clock.current.emittedUs = next;
      current.onPlayheadChange(next);
      if (next >= current.durationUs) current.onPlayingChange(false);
      else request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [options.playing, options.projectVersion]);

  useEffect(() => {
    if (options.playing && options.playheadUs !== clock.current.emittedUs) {
      clock.current.anchorUs = options.playheadUs;
      clock.current.anchorMs = performance.now();
      clock.current.emittedUs = options.playheadUs;
    }
  }, [options.playheadUs, options.playing]);

  const handlePlayPause = useCallback(() => {
    const { current } = latest;
    if (current.playing) current.onPlayingChange(false);
    else if (current.durationUs > 0) {
      if (current.playheadUs >= current.durationUs) current.onPlayheadChange(0);
      current.onPlayingChange(true);
    }
  }, []);
  return { handlePlayPause, buffering, playing: options.playing && stable };
}
