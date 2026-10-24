import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Preview from "../components/Preview";
import type { Project } from "../../electron/shared/ipc-contract";

vi.mock("../lib/bridge", () => ({
  mediaUrl: (path: string) =>
    `forgecut-media://source?path=${encodeURIComponent(path)}`,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps the music source across picture cuts and seeks, pauses and mixes every active source", () => {
  const outputs = new Map<
    HTMLMediaElement,
    { value: number; disconnected: boolean }
  >();
  const close = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal(
    "AudioContext",
    class {
      currentTime = 0;
      state = "running";
      destination = {};
      createMediaElementSource(media: HTMLMediaElement) {
        const output = { value: 1, disconnected: false };
        outputs.set(media, output);
        return {
          connect: () => {},
          disconnect: () => {
            output.disconnected = true;
          },
        };
      }
      createGain() {
        const output = [...outputs.values()].at(-1)!;
        return {
          gain: {
            setValueAtTime: (value: number) => {
              output.value = value;
            },
          },
          connect: () => {},
          disconnect: () => {},
        };
      }
      resume = vi.fn().mockResolvedValue(undefined);
      close = close;
    },
  );
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const pause = vi
    .spyOn(HTMLMediaElement.prototype, "pause")
    .mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
  const project: Project = {
    id: "project",
    name: "Music",
    settings: { width: 64, height: 36, fps: 1, sample_rate: 48000 },
    assets: [
      {
        id: "video",
        name: "Picture",
        kind: "Video",
        path: "/picture.mp4",
        probe: {
          duration_us: 3000000,
          width: 64,
          height: 36,
          fps: 20,
          codec: "h264",
          audio_channels: 2,
          audio_sample_rate: 48000,
        },
      },
      {
        id: "music",
        name: "Music",
        kind: "Audio",
        path: "/music.wav",
        probe: null,
      },
    ],
    timeline: {
      markers: [],
      tracks: [
        {
          id: "picture",
          kind: "Video",
          items: [
            {
              VideoClip: {
                id: "first",
                track_id: "picture",
                asset_id: "video",
                timeline_start_us: 0,
                source_in_us: 0,
                source_out_us: 1000000,
                volume: 0.5,
              },
            },
            {
              VideoClip: {
                id: "second",
                track_id: "picture",
                asset_id: "video",
                timeline_start_us: 1000000,
                source_in_us: 1000000,
                source_out_us: 2000000,
                muted: true,
              },
            },
          ],
        },
        {
          id: "music-track",
          kind: "Audio",
          items: [
            {
              AudioClip: {
                id: "bed",
                track_id: "music-track",
                asset_id: "music",
                timeline_start_us: 0,
                source_in_us: 0,
                source_out_us: 3000000,
                volume: 2,
              },
            },
          ],
        },
      ],
    },
  };
  const props = {
    project,
    projectVersion: 1,
    playheadUs: 500000,
    playing: true,
    onPlayheadChange: () => {},
    onPlayingChange: () => {},
  };
  const { rerender, unmount } = render(<Preview {...props} />);
  const music = document.querySelector("audio")!;
  const first = document.querySelector("video")!;
  expect(music).toBeTruthy();
  expect(music.currentTime).toBe(0.5);
  expect(outputs.get(music)?.value).toBe(2);
  expect(outputs.get(first)?.value).toBe(0.5);
  expect(play).toHaveBeenCalled();
  rerender(<Preview {...props} playheadUs={1500000} />);
  expect(document.querySelector("audio")).toBe(music);
  expect(music.currentTime).toBe(1.5);
  expect(outputs.get(first)?.disconnected).toBe(true);
  expect(outputs.get(document.querySelector("video")!)?.value).toBe(0);
  pause.mockClear();
  rerender(<Preview {...props} playheadUs={2000000} playing={false} />);
  expect(music.currentTime).toBe(2);
  expect(pause).toHaveBeenCalled();
  unmount();
  expect(outputs.get(music)?.disconnected).toBe(true);
  expect(close).toHaveBeenCalled();
});
