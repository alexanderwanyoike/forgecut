import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Preview from "../components/Preview";
import type { Project } from "../../electron/shared/ipc-contract";

vi.mock("../lib/bridge", () => ({
  invoke: vi.fn(async (command: string) =>
    command === "get_overlays_at_time" ? [] : null,
  ),
  mediaUrl: (path: string) =>
    `forgecut-media://source?path=${encodeURIComponent(path)}`,
}));

function videoProject(): Project {
  return {
    id: "project",
    name: "Preview",
    settings: { width: 640, height: 360, fps: 30, sample_rate: 48000 },
    assets: [
      {
        id: "source",
        name: "Video",
        path: "/clip.mp4",
        kind: "Video",
        probe: {
          duration_us: 12000000,
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
                id: "clip",
                track_id: "picture",
                asset_id: "source",
                timeline_start_us: 0,
                source_in_us: 0,
                source_out_us: 12000000,
              },
            },
          ],
        },
      ],
    },
  };
}
const idle = {
  projectVersion: 0,
  playheadUs: 0,
  playing: false,
  onPlayingChange: () => {},
  onPlayheadChange: () => {},
};

describe("Preview component", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(
      4,
    );
  });
  it("renders the play control", () => {
    render(<Preview {...idle} />);
    expect(screen.getByRole("button").textContent).toContain("▶");
  });
  it("shows the stop icon during playback", () => {
    render(<Preview {...idle} project={videoProject()} playing />);
    expect(screen.getByRole("button").textContent).toContain("⏹");
  });
  it("formats the playhead time", () => {
    render(<Preview {...idle} playheadUs={65500000} />);
    expect(screen.getByText("00:01:05.500")).toBeTruthy();
  });
  it("seeks the current source when the paused playhead changes", async () => {
    const project = videoProject();
    const { rerender } = render(
      <Preview {...idle} project={project} playheadUs={1000000} />,
    );
    await waitFor(() =>
      expect(
        document.querySelector<HTMLVideoElement>("video")?.currentTime,
      ).toBe(1),
    );
    rerender(<Preview {...idle} project={project} playheadUs={4000000} />);
    await waitFor(() =>
      expect(
        document.querySelector<HTMLVideoElement>("video")?.currentTime,
      ).toBe(4),
    );
  });
  it("leaves a real gap black rather than retaining an old source", () => {
    const project = videoProject();
    const clip = project.timeline.tracks[0].items[0];
    if (!("VideoClip" in clip)) throw new Error("Invalid video fixture");
    clip.VideoClip.timeline_start_us = 2000000;
    render(<Preview {...idle} project={project} />);
    expect(document.querySelector(".preview-viewport video")).toBeNull();
  });
  it("renders active text from the current project snapshot", () => {
    const project = videoProject();
    project.timeline.tracks = [
      {
        id: "titles",
        kind: "OverlayText",
        items: [
          {
            TextOverlay: {
              id: "title",
              track_id: "titles",
              timeline_start_us: 0,
              duration_us: 3000000,
              text: "Current title",
              font_size: 48,
              color: "#ffffff",
              x: 100,
              y: 100,
            },
          },
        ],
      },
    ];
    render(<Preview {...idle} project={project} />);
    expect(screen.getByText("Current title")).toBeTruthy();
  });
  it("pauses on project edits while retaining normal clock position updates", () => {
    const props = {
      ...idle,
      project: videoProject(),
      playing: true,
      projectVersion: 0,
      onPlayingChange: vi.fn(),
    };
    const { rerender } = render(<Preview {...props} />);
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    pause.mockClear();
    rerender(<Preview {...props} playheadUs={1000000} />);
    expect(pause).not.toHaveBeenCalled();
    rerender(<Preview {...props} playheadUs={1000000} projectVersion={1} />);
    expect(pause).toHaveBeenCalled();
    expect(props.onPlayingChange).toHaveBeenCalledWith(false);
  });
  it("does not start a stale source after delayed metadata arrives", () => {
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(
      0,
    );
    const props = {
      ...idle,
      project: videoProject(),
      playing: true,
      projectVersion: 0,
      onPlayingChange: vi.fn(),
    };
    const { rerender } = render(<Preview {...props} />);
    const old = document.querySelector("video")!;
    const next = videoProject();
    next.assets[0].path = "/new.mp4";
    rerender(<Preview {...props} project={next} projectVersion={1} />);
    fireEvent.loadedMetadata(old);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
  it("replaces a removed item immediately when the owner publishes another snapshot", () => {
    const project = videoProject();
    const { rerender } = render(<Preview {...idle} project={project} />);
    expect(document.querySelector("video")).toBeTruthy();
    const next = videoProject();
    next.timeline.tracks[0].items = [];
    rerender(<Preview {...idle} project={next} projectVersion={1} />);
    expect(document.querySelector("video")).toBeNull();
  });
});
