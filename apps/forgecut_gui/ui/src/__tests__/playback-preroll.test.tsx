import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Preview from "../components/Preview";
import type { Project, TimelineItem } from "../../electron/shared/ipc-contract";

vi.mock("../lib/bridge", () => ({
  mediaUrl: (path: string) =>
    `forgecut-media://source?path=${encodeURIComponent(path)}`,
}));

function clip(
  id: string,
  path: string,
  timelineStartUs: number,
  sourceInUs: number,
): { asset: Project["assets"][number]; item: TimelineItem } {
  return {
    asset: {
      id: `${id}-source`,
      name: id,
      path,
      kind: "Video",
      probe: {
        duration_us: 600000000,
        width: 640,
        height: 360,
        fps: 30,
        codec: "h264",
        audio_channels: 0,
        audio_sample_rate: 0,
      },
    },
    item: {
      VideoClip: {
        id,
        track_id: "picture",
        asset_id: `${id}-source`,
        timeline_start_us: timelineStartUs,
        source_in_us: sourceInUs,
        source_out_us: sourceInUs + 2000000,
      },
    },
  };
}

function project(...clips: ReturnType<typeof clip>[]): Project {
  return {
    id: "project",
    name: "Preroll",
    settings: { width: 640, height: 360, fps: 30, sample_rate: 48000 },
    assets: clips.map((value) => value.asset),
    timeline: {
      markers: [],
      tracks: [
        {
          id: "picture",
          kind: "Video",
          items: clips.map((value) => value.item),
        },
      ],
    },
  };
}

const recording = () => clip("recording", "/recording.mkv", 0, 5000000);
const cut = () => [
  clip("first", "/first.mp4", 0, 0),
  clip("second", "/recording.mkv", 2000000, 5000000),
];

function props(value: Project, playheadUs: number, playing = false) {
  return {
    project: value,
    projectVersion: 1,
    playheadUs,
    playing,
    onPlayingChange: vi.fn(),
    onPlayheadChange: vi.fn(),
  };
}

function video(path: string): HTMLVideoElement {
  const found = document.querySelector<HTMLVideoElement>(
    `video[src*="${encodeURIComponent(path)}"]`,
  );
  if (!found) throw new Error(`No video for ${path}`);
  return found;
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("hides a source until the frame at its cut is decoded", () => {
  render(<Preview {...props(project(recording()), 0)} />);
  const source = video("/recording.mkv");
  expect(source.currentTime).toBe(5);
  expect(source.style.visibility).toBe("hidden");
  fireEvent.seeked(source);
  expect(source.style.visibility).toBe("visible");
});

it("keeps the last frame visible while a playing source corrects its position", () => {
  const value = project(recording());
  const view = render(<Preview {...props(value, 0, true)} />);
  const source = video("/recording.mkv");
  fireEvent.seeked(source);
  view.rerender(<Preview {...props(value, 1000000, true)} />);
  expect(source.currentTime).toBe(6);
  expect(source.style.visibility).toBe("visible");
});

it("leaves small clock differences to the playing source", () => {
  const value = project(recording());
  const view = render(<Preview {...props(value, 0, true)} />);
  const source = video("/recording.mkv");
  fireEvent.seeked(source);
  view.rerender(<Preview {...props(value, 100000, true)} />);
  expect(source.currentTime).toBe(5);
});

it("prepares the next clip at its cut before the playhead reaches it", () => {
  render(<Preview {...props(project(...cut()), 1000000, true)} />);
  const next = video("/recording.mkv");
  expect(next.currentTime).toBe(5);
  fireEvent.seeked(next);
  expect(next.style.visibility).toBe("hidden");
  expect(
    vi.mocked(HTMLMediaElement.prototype.play).mock.contexts,
  ).not.toContain(next);
});

it("shows the prepared clip without reloading it when the cut arrives", () => {
  const value = project(...cut());
  const view = render(<Preview {...props(value, 1000000, true)} />);
  const next = video("/recording.mkv");
  fireEvent.seeked(next);
  view.rerender(<Preview {...props(value, 2000000, true)} />);
  expect(video("/recording.mkv")).toBe(next);
  expect(next.style.visibility).toBe("visible");
});

it("holds the clock until the active source presents its frame", async () => {
  const current = props(project(recording()), 0, true);
  render(<Preview {...current} />);
  await new Promise((done) => setTimeout(done, 120));
  expect(current.onPlayheadChange).not.toHaveBeenCalled();
  fireEvent.seeked(video("/recording.mkv"));
  await vi.waitFor(() =>
    expect(current.onPlayheadChange).toHaveBeenCalledWith(expect.any(Number)),
  );
});

it("prepares upcoming clips one at a time, nearest first", () => {
  render(
    <Preview
      {...props(
        project(
          clip("current", "/current.mp4", 0, 0),
          clip("later", "/recording.mkv", 1500000, 9000000),
          clip("next", "/next.mkv", 1000000, 5000000),
        ),
        500000,
        true,
      )}
    />,
  );
  expect(document.querySelector('video[src*="recording.mkv"]')).toBeNull();
  fireEvent.seeked(video("/next.mkv"));
  expect(video("/recording.mkv").currentTime).toBe(9);
});
