import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePlayback } from "../hooks/usePlayback";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("holds the timeline while media buffers and resumes without skipping the wait", () => {
  let tick: FrameRequestCallback = () => {};
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    tick = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(performance, "now").mockReturnValue(0);
  const onPlayheadChange = vi.fn();
  let ready = false;
  const { result } = renderHook(() =>
    usePlayback({
      projectVersion: 0,
      durationUs: 1000000,
      playheadUs: 0,
      playing: true,
      onPlayingChange: vi.fn(),
      onPlayheadChange,
      canAdvance: () => ready,
    }),
  );
  act(() => tick(100));
  expect(onPlayheadChange).not.toHaveBeenCalled();
  expect(result.current.playing).toBe(false);
  ready = true;
  act(() => tick(900));
  expect(onPlayheadChange).not.toHaveBeenCalled();
  expect(result.current.playing).toBe(true);
  act(() => tick(1000));
  expect(onPlayheadChange).toHaveBeenLastCalledWith(100000);
});
