import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Preview from "../components/Preview";
import type { Project } from "../../electron/shared/ipc-contract";
import { invoke } from "../lib/bridge";

vi.mock("../lib/bridge", () => ({
  mediaUrl: (path: string) =>
    `forgecut-media://source?path=${encodeURIComponent(path)}`,
  invoke: vi.fn(),
}));

const project: Project = {
  id: "project",
  name: "Proxies",
  settings: { width: 640, height: 360, fps: 30, sample_rate: 48000 },
  assets: [
    {
      id: "recording",
      name: "Recording",
      path: "/footage/recording.mkv",
      kind: "Video",
      probe: {
        duration_us: 600000000,
        width: 1920,
        height: 1080,
        fps: 60,
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
              id: "clip",
              track_id: "picture",
              asset_id: "recording",
              timeline_start_us: 0,
              source_in_us: 445000000,
              source_out_us: 447000000,
            },
          },
        ],
      },
    ],
  },
};

function sources(): string[] {
  return [...document.querySelectorAll("video")].map((video) =>
    decodeURIComponent(video.getAttribute("src") ?? ""),
  );
}

function show() {
  render(
    <Preview
      project={project}
      projectVersion={1}
      playheadUs={0}
      playing={false}
      onPlayingChange={vi.fn()}
      onPlayheadChange={vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(invoke).mockReset();
});

it("plays a clip from its seek-friendly proxy once it is ready", async () => {
  vi.mocked(invoke).mockResolvedValue({ path: "/cache/recording.mp4" });
  show();
  await waitFor(() =>
    expect(sources()).toEqual([
      expect.stringContaining("/cache/recording.mp4"),
    ]),
  );
  expect(invoke).toHaveBeenCalledWith("get_preview_proxy", {
    assetId: "recording",
  });
});

it("plays the original source while its proxy is encoding", () => {
  vi.mocked(invoke).mockReturnValue(new Promise(() => {}));
  show();
  expect(sources()).toEqual([
    expect.stringContaining("/footage/recording.mkv"),
  ]);
});

it("plays the original source when it needs no proxy", async () => {
  vi.mocked(invoke).mockResolvedValue({ path: null });
  show();
  await waitFor(() => expect(invoke).toHaveBeenCalled());
  await new Promise((done) => setTimeout(done, 20));
  expect(sources()).toEqual([
    expect.stringContaining("/footage/recording.mkv"),
  ]);
});
