import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import titleSource from "../../electron/graphics/TitleCard.tsx?raw";
import { AppState } from "../../electron/backend/state";
import { EditingService } from "../../electron/backend/editing-service";
import Preview from "../components/Preview";
import Inspector from "../components/Inspector";
import Timeline from "../components/Timeline";
import { invoke } from "../lib/bridge";

const { update } = vi.hoisted(() => ({
  update: vi.fn().mockResolvedValue(null),
}));
vi.mock("node:fs", () => {
  const mocked = { readFileSync: () => titleSource };
  return { ...mocked, default: mocked };
});
vi.mock("../lib/bridge", () => ({
  mediaUrl: (path: string) => path,
  invoke: vi.fn().mockResolvedValue(null),
  invokeGrouped: update,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("seeks the real Player from sequence time and exposes typed instance controls", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  const result = await service.execute("add_graphic_item", {
    templateId: "title-card",
    trackId: "graphics",
    timelineStartUs: 1000000,
    durationUs: 2000000,
    props: { title: "Your build" },
  });
  if (!result.ok) throw new Error(result.error.message);
  const item = state.project.timeline.tracks[0].items[0];
  if (!("RemotionGraphic" in item)) throw new Error("Invalid fixture");
  const props = {
    project: state.project,
    projectVersion: state.revision,
    playing: false,
    onPlayingChange: vi.fn(),
    onPlayheadChange: vi.fn(),
  };
  const view = render(<Preview {...props} playheadUs={1000000} />);
  await waitFor(() => expect(screen.getByText("Your build")).toBeTruthy());
  expect(screen.getByText("Your build").style.opacity).toBe("0");
  view.rerender(<Preview {...props} playheadUs={1500000} />);
  await waitFor(() =>
    expect(screen.getByText("Your build").style.opacity).toBe("1"),
  );
  view.rerender(
    <Inspector
      project={state.project}
      selectedClipId={item.RemotionGraphic.id}
    />,
  );
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Through the bends" },
  });
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(expect.any(String), "update_item", {
      itemId: item.RemotionGraphic.id,
      patch: {
        kind: "RemotionGraphic",
        changes: { props: { title: "Through the bends" } },
      },
    }),
  );
});
it("reports an unavailable component rather than substituting different source", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  await service.execute("add_graphic_item", {
    templateId: "title-card",
    trackId: "graphics",
    timelineStartUs: 0,
    durationUs: 2000000,
  });
  const project = structuredClone(state.project);
  project.components![0].source.files["main.tsx"] += "\n// different source";
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
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "component version",
    ),
  );
});

it("adds a title at the playhead through the shared service command", async () => {
  render(
    <Timeline
      playheadUs={750000}
      playing={false}
      onPlayingChange={vi.fn()}
      onPlayheadChange={vi.fn()}
      selectedClipId={null}
      onSelectedClipChange={vi.fn()}
      projectVersion={0}
      projectTimeline={{ tracks: [], markers: [] }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "+ Graphic" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      "add_graphic_item",
      expect.objectContaining({
        templateId: "title-card",
        timelineStartUs: 750000,
        durationUs: 3000000,
      }),
    ),
  );
});
