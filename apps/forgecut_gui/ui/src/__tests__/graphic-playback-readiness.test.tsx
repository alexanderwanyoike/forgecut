import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import titleSource from "../../electron/graphics/TitleCard.tsx?raw";
import { AppState } from "../../electron/backend/state";
import { EditingService } from "../../electron/backend/editing-service";
import { componentVersion } from "../../electron/backend/graphic-component";
import Preview from "../components/Preview";
import { invoke } from "../lib/bridge";

vi.mock("node:fs", () => {
  const mocked = { readFileSync: () => titleSource };
  return { ...mocked, default: mocked };
});
vi.mock("../lib/bridge", () => ({
  mediaUrl: (path: string) => path,
  invoke: vi.fn(),
  invokeGrouped: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("holds the sequence until the first custom graphic image is displayed", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  try {
    await service.execute("add_graphic_item", {
      templateId: "title-card",
      trackId: "graphics",
      timelineStartUs: 0,
      durationUs: 1200000,
      props: { title: "Visible card" },
    });
    const project = structuredClone(state.project);
    const component = project.components![0];
    component.source.files[component.source.entry] += "\n";
    component.version = componentVersion(component);
    const item = project.timeline.tracks[0].items[0];
    if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
    item.RemotionGraphic.component_version = component.version;
    let complete: (value: unknown) => void = () => {};
    vi.mocked(invoke).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    let tick: FrameRequestCallback = () => {};
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
      (callback) => {
        tick = callback;
        return 1;
      },
    );
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    vi.spyOn(performance, "now").mockReturnValue(0);
    const onPlayheadChange = vi.fn();
    render(
      <Preview
        project={project}
        projectVersion={1}
        playheadUs={0}
        playing
        onPlayheadChange={onPlayheadChange}
        onPlayingChange={vi.fn()}
      />,
    );
    await screen.findByText("Preparing graphic…");
    act(() => tick(100));
    expect(onPlayheadChange).not.toHaveBeenCalled();
    await act(async () =>
      complete({ mimeType: "image/png", data: "AA==", width: 64, height: 36 }),
    );
    const image = screen.getByAltText("Graphic preview");
    act(() => tick(200));
    expect(onPlayheadChange).not.toHaveBeenCalled();
    fireEvent.load(image);
    act(() => tick(300));
    act(() => tick(400));
    expect(onPlayheadChange).toHaveBeenLastCalledWith(100000);
  } finally {
    await service.closeGraphicsPreview();
    await service.jobs.close();
  }
});
