import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Preview from "../components/Preview";
import type { Project } from "../../electron/shared/ipc-contract";

vi.mock("../lib/bridge", () => ({
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
    cleanup();
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
    expect(screen.getByRole("button", { name: "Play sequence" })).toBeTruthy();
  });
  it("names the pause control during playback", () => {
    render(<Preview {...idle} project={videoProject()} playing />);
    expect(screen.getByRole("button", { name: "Pause sequence" })).toBeTruthy();
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
  it("waits for decoded data before seeking a newly loaded source", () => {
    const ready = vi
      .spyOn(HTMLMediaElement.prototype, "readyState", "get")
      .mockReturnValue(1);
    render(<Preview {...idle} project={videoProject()} playheadUs={4000000} />);
    const video = document.querySelector("video")!;
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(0);
    ready.mockReturnValue(2);
    fireEvent.loadedData(video);
    expect(video.currentTime).toBe(4);
  });
  it("seeks to the latest paused playhead after an outstanding seek finishes", () => {
    const ready = vi
      .spyOn(HTMLMediaElement.prototype, "readyState", "get")
      .mockReturnValue(4);
    const project = videoProject();
    const { rerender } = render(
      <Preview {...idle} project={project} playheadUs={1000000} />,
    );
    const video = document.querySelector("video")!;
    expect(video.currentTime).toBe(1);
    ready.mockReturnValue(1);
    rerender(<Preview {...idle} project={project} playheadUs={4000000} />);
    expect(video.currentTime).toBe(1);
    ready.mockReturnValue(2);
    fireEvent.seeked(video);
    expect(video.currentTime).toBe(4);
  });
  it("keeps unprobed source audio silent until it can match export", () => {
    const project = videoProject();
    project.assets[0].probe = null;
    render(<Preview {...idle} project={project} />);
    expect(document.querySelector("video")?.muted).toBe(true);
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
  it("uses resolved visual transforms and stacking in composition coordinates", () => {
    const project = videoProject();
    const clip = project.timeline.tracks[0].items[0];
    if (!("VideoClip" in clip)) throw new Error("Invalid picture fixture");
    clip.VideoClip.transform = {
      x: 200,
      y: 120,
      width: 160,
      height: 90,
      fit: "cover",
      opacity: 0.5,
    };
    clip.VideoClip.layer_order = 2;
    project.assets.push({
      id: "art",
      name: "Art",
      path: "/art.png",
      kind: "Image",
      probe: null,
    });
    project.timeline.tracks.push({
      id: "artwork",
      kind: "OverlayImage",
      items: [
        {
          ImageOverlay: {
            id: "art-item",
            asset_id: "art",
            track_id: "artwork",
            timeline_start_us: 0,
            duration_us: 1000000,
            x: 10.4,
            y: 20.6,
            width: 100,
            height: 50,
            opacity: 0.7,
            fit: "cover",
            layer_order: 0,
          },
        },
      ],
    });
    render(<Preview {...idle} project={project} />);
    const video = document.querySelector("video")!;
    expect(video.style.left).toBe("200px");
    expect(video.style.width).toBe("160px");
    expect(video.style.objectFit).toBe("cover");
    expect(video.style.opacity).toBe("0.5");
    expect(video.style.background).toBe("transparent");
    const image = screen.getByRole("img");
    expect(image.style.left).toBe("10px");
    expect(image.style.top).toBe("21px");
    expect(image.style.objectFit).toBe("cover");
    expect(video.parentElement?.firstElementChild).toBe(image);
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
  it("does not report a play request interrupted by a normal pause", async () => {
    let rejectPlay: (error: Error) => void = () => {};
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPlay = reject;
        }),
    );
    const project = videoProject();
    const { rerender } = render(
      <Preview {...idle} project={project} playing />,
    );
    rerender(<Preview {...idle} project={project} playing={false} />);
    await act(async () => {
      rejectPlay(new DOMException("Interrupted by pause", "AbortError"));
      await Promise.resolve();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("clears a failed source warning when a new project snapshot replaces it", () => {
    const project = videoProject();
    const { rerender } = render(<Preview {...idle} project={project} />);
    fireEvent.error(document.querySelector("video")!);
    expect(screen.getByRole("alert").textContent).toContain("Unable to play");
    const next = videoProject();
    next.assets[0].path = "/working.mp4";
    rerender(<Preview {...idle} project={next} projectVersion={1} />);
    expect(screen.queryByRole("alert")).toBeNull();
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
