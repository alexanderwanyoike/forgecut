import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Preview from "../components/Preview";
import type { Project } from "../../electron/shared/ipc-contract";

vi.mock("../lib/bridge", () => ({
  mediaUrl: (path: string) =>
    `forgecut-media://source?path=${encodeURIComponent(path)}`,
  invoke: () => new Promise(() => {}),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const project: Project = {
  id: "project",
  name: "Sequence",
  settings: { width: 640, height: 360, fps: 30, sample_rate: 48000 },
  assets: [
    {
      id: "video",
      name: "Video",
      path: "/video.mp4",
      kind: "Video",
      probe: {
        duration_us: 5000000,
        width: 640,
        height: 360,
        fps: 30,
        codec: "h264",
        audio_channels: 0,
        audio_sample_rate: 0,
      },
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
              asset_id: "video",
              track_id: "picture",
              timeline_start_us: 500000,
              source_in_us: 0,
              source_out_us: 500000,
            },
          },
          {
            VideoClip: {
              id: "second",
              asset_id: "video",
              track_id: "picture",
              timeline_start_us: 1500000,
              source_in_us: 2000000,
              source_out_us: 2500000,
            },
          },
        ],
      },
      {
        id: "titles",
        kind: "OverlayText",
        items: [
          {
            TextOverlay: {
              id: "ending",
              track_id: "titles",
              timeline_start_us: 2500000,
              duration_us: 500000,
              text: "End",
              font_size: 24,
              color: "#ffffff",
              x: 0,
              y: 0,
            },
          },
        ],
      },
    ],
  },
};

it("keeps the sequence clock running through cuts and gaps until the sequence end", async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
  function Player() {
    const [playing, setPlaying] = useState(false);
    const [playheadUs, setPlayheadUs] = useState(0);
    return (
      <Preview
        project={project}
        projectVersion={0}
        playheadUs={playheadUs}
        playing={playing}
        onPlayingChange={setPlaying}
        onPlayheadChange={setPlayheadUs}
      />
    );
  }
  render(<Player />);
  fireEvent.click(screen.getByRole("button"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2200);
  });
  expect(screen.getByRole("button", { name: "Pause sequence" })).toBeTruthy();
  expect(screen.getByText(/00:00:02\./)).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(screen.getByRole("button", { name: "Play sequence" })).toBeTruthy();
  expect(screen.getByText("00:00:03.000")).toBeTruthy();
});
