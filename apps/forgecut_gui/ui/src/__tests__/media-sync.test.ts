import { expect, it } from "vitest";
import { mediaSync, type MediaSyncState } from "../lib/preview/media-sync";

const decoded: MediaSyncState = {
  readyState: 4,
  currentTime: 5,
  loading: false,
  seekPending: false,
};

it("waits until the source has metadata", () => {
  expect(mediaSync({ ...decoded, readyState: 0 }, 5, true)).toEqual({
    wait: true,
  });
});

it("presents a decoded source already at its target", () => {
  expect(mediaSync(decoded, 5, true)).toEqual({
    wait: false,
    seekTo: undefined,
    presentable: true,
  });
});

it("seeks exactly when precise and hides until the seek lands", () => {
  expect(mediaSync(decoded, 5.01, true)).toEqual({
    wait: false,
    seekTo: 5.01,
    presentable: false,
  });
  expect(mediaSync({ ...decoded, seekPending: true }, 5, true)).toMatchObject({
    presentable: false,
  });
});

it("leaves small drift to a playing source and corrects large drift", () => {
  expect(mediaSync(decoded, 5.1, false)).toMatchObject({ seekTo: undefined });
  expect(mediaSync(decoded, 6, false)).toMatchObject({ seekTo: 6 });
});

it("defers a seek while the source is still reading or lacks a frame", () => {
  expect(mediaSync({ ...decoded, loading: true }, 6, false)).toEqual({
    wait: true,
  });
  expect(mediaSync({ ...decoded, readyState: 1 }, 6, false)).toEqual({
    wait: true,
  });
});
