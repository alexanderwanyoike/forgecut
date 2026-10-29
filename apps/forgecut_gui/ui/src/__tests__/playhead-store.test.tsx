import { act, render, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ProjectSnapshot } from "../../electron/shared/ipc-contract";
import { createPlayhead } from "../lib/playhead";
import { useEditingContext } from "../hooks/useEditingContext";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  clipRenders: { count: 0 },
}));
vi.mock("../lib/bridge", () => ({
  invoke: mocks.invoke,
  mediaUrl: (path: string) => `forgecut-media://${path}`,
}));
vi.mock("../components/TimelineClip", () => ({
  default: () => {
    mocks.clipRenders.count += 1;
    return null;
  },
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

import Timeline from "../components/Timeline";

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue(null);
  mocks.clipRenders.count = 0;
});

it("moves the timeline playhead without redrawing its clips", () => {
  const playhead = createPlayhead(0);
  render(
    <Timeline
      playhead={playhead}
      playing
      onPlayheadChange={() => {}}
      onPlayingChange={() => {}}
      selectedClipId={null}
      onSelectedClipChange={() => {}}
      projectVersion={0}
      projectTimeline={{
        markers: [],
        tracks: [
          {
            id: "picture",
            kind: "Video",
            items: [
              {
                VideoClip: {
                  id: "clip",
                  asset_id: "source",
                  track_id: "picture",
                  timeline_start_us: 0,
                  source_in_us: 0,
                  source_out_us: 12_000_000,
                },
              },
            ],
          },
        ],
      }}
    />,
  );
  const before = mocks.clipRenders.count;
  const marker = document.querySelector<HTMLElement>(".playhead")!;
  const start = marker.style.left;
  for (const us of [16_667, 33_333, 50_000, 1_000_000])
    act(() => playhead.set(us));
  expect(marker.style.left).not.toBe(start);
  expect(mocks.clipRenders.count).toBe(before);
});

it("reports the playhead when playback stops rather than on every frame", () => {
  const playhead = createPlayhead(0);
  const snapshot = {
    sessionId: "session",
    revision: 1,
    sequenceRevision: 1,
    project: {
      id: "project",
      name: "Context",
      settings: { width: 64, height: 36, fps: 30, sample_rate: 48000 },
      assets: [],
      timeline: { markers: [], tracks: [] },
    },
  } as unknown as ProjectSnapshot;
  const view = renderHook(
    ({ playing }) => useEditingContext(snapshot, null, playhead, playing, null),
    { initialProps: { playing: true } },
  );
  mocks.invoke.mockClear();
  for (const us of [16_667, 33_333, 50_000]) act(() => playhead.set(us));
  expect(mocks.invoke).not.toHaveBeenCalled();
  view.rerender({ playing: false });
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
    "set_editing_context",
    expect.objectContaining({ playheadUs: 50_000 }),
  );
  act(() => playhead.set(70_000));
  expect(mocks.invoke).toHaveBeenLastCalledWith(
    "set_editing_context",
    expect.objectContaining({ playheadUs: 70_000 }),
  );
});
