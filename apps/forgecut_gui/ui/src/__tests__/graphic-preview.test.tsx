import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import titleSource from "../../electron/graphics/TitleCard.tsx?raw";
import { componentVersion } from "../../electron/backend/graphic-component";
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
it("shows isolated custom frames without evaluating source in the editor", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  await service.execute("add_graphic_item", {
    templateId: "title-card", trackId: "graphics", timelineStartUs: 0, durationUs: 2000000,
  });
  const project = structuredClone(state.project);
  const component = project.components![0];
  component.source.files[component.source.entry] = 'export default function Card(){throw new Error("Never execute in editor");}';
  component.version = componentVersion(component);
  const item = project.timeline.tracks[0].items[0];
  if (!("RemotionGraphic" in item)) throw new Error("Invalid fixture");
  item.RemotionGraphic.component_version = component.version;
  vi.mocked(invoke).mockResolvedValueOnce({mimeType:"image/png",data:"aXNvbGF0ZWQ=",width:64,height:36});
  render(<Preview project={project} projectVersion={1} playheadUs={500000} playing={false} onPlayingChange={vi.fn()} onPlayheadChange={vi.fn()} />);
  await waitFor(() => expect(screen.getByAltText("Graphic preview").getAttribute("src")).toBe("data:image/png;base64,aXNvbGF0ZWQ="));
  expect(invoke).toHaveBeenCalledWith("get_graphic_preview", expect.objectContaining({itemId:item.RemotionGraphic.id,frame:15}));
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

it("crops the composition when a graphic uses cover placement", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  await service.execute("add_graphic_item", {
    templateId: "title-card",
    trackId: "graphics",
    timelineStartUs: 0,
    durationUs: 2000000,
  });
  const project = structuredClone(state.project);
  const item = project.timeline.tracks[0].items[0];
  if (!("RemotionGraphic" in item)) throw new Error("Invalid fixture");
  item.RemotionGraphic.transform = {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    opacity: 1,
    fit: "cover",
  };
  const view = render(
    <Preview
      project={project}
      projectVersion={1}
      playheadUs={500000}
      playing={false}
      onPlayingChange={vi.fn()}
      onPlayheadChange={vi.fn()}
    />,
  );
  await waitFor(() =>
    expect(view.container.querySelector(".graphic-player")).toBeTruthy(),
  );
  const player = view.container.querySelector<HTMLElement>(".graphic-player")!;
  expect(parseFloat(player.style.width)).toBeCloseTo(177.7778, 3);
  expect(player.style.height).toBe("100px");
  expect(parseFloat(player.style.left)).toBeCloseTo(-38.8889, 3);
  expect(player.parentElement?.style.overflow).toBe("hidden");
});

it("shows RGBA colours accurately and preserves alpha when the picker changes RGB", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  await service.execute("add_graphic_item", {
    templateId: "title-card",
    trackId: "graphics",
    timelineStartUs: 0,
    durationUs: 2000000,
    props: { color: "#ff000080" },
  });
  const item = state.project.timeline.tracks[0].items[0];
  if (!("RemotionGraphic" in item)) throw new Error("Invalid fixture");
  render(
    <Inspector
      project={state.project}
      selectedClipId={item.RemotionGraphic.id}
    />,
  );
  expect((screen.getByLabelText("Color") as HTMLInputElement).value).toBe(
    "#ff0000",
  );
  expect((screen.getByLabelText("Color hex") as HTMLInputElement).value).toBe(
    "#ff000080",
  );
  fireEvent.change(screen.getByLabelText("Color"), {
    target: { value: "#00ff00" },
  });
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(expect.any(String), "update_item", {
      itemId: item.RemotionGraphic.id,
      patch: {
        kind: "RemotionGraphic",
        changes: { props: { color: "#00ff0080" } },
      },
    }),
  );
});

it("rejects a component with known source but a different property contract", async () => {
  const state = new AppState();
  await new EditingService(state).execute("add_graphic_item", {
    templateId: "title-card",
    trackId: "graphics",
    timelineStartUs: 0,
    durationUs: 1000000,
  });
  const project = structuredClone(state.project);
  const component = project.components![0];
  component.properties.title.label = "Different contract";
  component.version = componentVersion(component);
  const item = project.timeline.tracks[0].items[0];
  if (!("RemotionGraphic" in item)) throw new Error("Invalid fixture");
  item.RemotionGraphic.component_version = component.version;
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

it("keeps multiline text editable in Properties", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  await service.execute("add_graphic_item", {
    templateId: "title-card",
    trackId: "graphics",
    timelineStartUs: 0,
    durationUs: 2000000,
  });
  const item = state.project.timeline.tracks[0].items[0];
  if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
  render(
    <Inspector
      project={state.project}
      selectedClipId={item.RemotionGraphic.id}
    />,
  );
  const title = screen.getByLabelText("Title");
  expect(title.tagName).toBe("TEXTAREA");
  fireEvent.change(title, { target: { value: "After\ndark." } });
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(expect.any(String), "update_item", {
      itemId: item.RemotionGraphic.id,
      patch: {
        kind: "RemotionGraphic",
        changes: { props: { title: "After\ndark." } },
      },
    }),
  );
});
