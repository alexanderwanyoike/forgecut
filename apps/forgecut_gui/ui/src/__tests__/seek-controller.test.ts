import { describe, it, expect, vi, beforeEach } from "vitest";
import { SeekController } from "../lib/preview/seek-controller";

/** Create a mock HTMLVideoElement with controllable seeking behavior */
function createMockVideo() {
  const listeners: Record<string, Array<() => void>> = {};
  let _currentTime = 0;
  let _seeking = false;

  const video = {
    get currentTime() {
      return _currentTime;
    },
    set currentTime(val: number) {
      _currentTime = val;
      _seeking = true;
    },
    get seeking() {
      return _seeking;
    },
    addEventListener(event: string, handler: () => void) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
    removeEventListener(event: string, handler: () => void) {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((h) => h !== handler);
      }
    },
    /** Simulate the browser firing the 'seeked' event */
    completeSeeked() {
      _seeking = false;
      for (const handler of listeners["seeked"] || []) {
        handler();
      }
    },
  };

  return video as unknown as HTMLVideoElement & { completeSeeked: () => void };
}

describe("SeekController", () => {
  let controller: SeekController;
  let video: ReturnType<typeof createMockVideo>;

  beforeEach(() => {
    controller = new SeekController();
    video = createMockVideo();
    controller.attach(video);
  });

  it("seeks immediately when idle", () => {
    controller.requestSeek(5.0);
    expect(video.currentTime).toBe(5.0);
    expect(controller.isSeeking).toBe(true);
  });

  it("queues seek when one is in progress", () => {
    controller.requestSeek(5.0);
    expect(video.currentTime).toBe(5.0);

    // Request another seek while first is in progress
    controller.requestSeek(10.0);
    // currentTime should NOT have changed yet
    expect(video.currentTime).toBe(5.0);
    expect(controller.isSeeking).toBe(true);
  });

  it("processes queued seek after current completes", async () => {
    controller.requestSeek(5.0);
    controller.requestSeek(10.0);

    // Complete the first seek
    video.completeSeeked();

    // Wait for the 16ms debounce
    await new Promise((r) => setTimeout(r, 20));

    expect(video.currentTime).toBe(10.0);
  });

  it("coalesces multiple queued seeks (latest wins)", async () => {
    controller.requestSeek(5.0);

    // Queue several seeks rapidly
    controller.requestSeek(10.0);
    controller.requestSeek(15.0);
    controller.requestSeek(20.0);

    // Complete the first seek
    video.completeSeeked();

    // Wait for debounce
    await new Promise((r) => setTimeout(r, 20));

    // Only the latest (20.0) should have been applied
    expect(video.currentTime).toBe(20.0);
  });

  it("returns to idle after all seeks complete", async () => {
    controller.requestSeek(5.0);
    video.completeSeeked();

    // No pending seek, should be idle
    expect(controller.isSeeking).toBe(false);
  });

  it("calls onSeeked callback after each completion", () => {
    const callback = vi.fn();
    controller.onSeeked(callback);

    controller.requestSeek(5.0);
    video.completeSeeked();

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("reset clears pending seeks", async () => {
    controller.requestSeek(5.0);
    controller.requestSeek(10.0);

    controller.reset();

    expect(controller.isSeeking).toBe(false);

    // Even if we complete the old seek, nothing should happen
    video.completeSeeked();
    await new Promise((r) => setTimeout(r, 20));

    // currentTime should still be 5.0 (the first seek), not 10.0
    expect(video.currentTime).toBe(5.0);
  });

  it("detach removes event listener", () => {
    const callback = vi.fn();
    controller.onSeeked(callback);

    controller.detach();

    controller.requestSeek(5.0);
    // After detach, requestSeek should be a no-op (no video)
    expect(callback).not.toHaveBeenCalled();
  });
});
