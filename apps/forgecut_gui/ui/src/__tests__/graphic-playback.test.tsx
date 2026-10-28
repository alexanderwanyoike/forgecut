import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import titleSource from "../../electron/graphics/TitleCard.tsx?raw";
import { AppState } from "../../electron/backend/state";
import { EditingService } from "../../electron/backend/editing-service";
import type { Project } from "../../electron/shared/ipc-contract";
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
  vi.clearAllMocks();
});

async function titled(title: string) {
  const state = new AppState();
  const service = new EditingService(state);
  const added = await service.execute("add_graphic_item", {
    templateId: "title-card",
    trackId: "graphics",
    timelineStartUs: 0,
    durationUs: 2000000,
    props: { title },
  });
  if (!added.ok) throw new Error(added.error.message);
  const item = state.project.timeline.tracks[0].items[0];
  if (!("RemotionGraphic" in item)) throw new Error("Invalid fixture");
  return { project: state.project, itemId: item.RemotionGraphic.id };
}

function retitled(project: Project, title: string): Project {
  const next = structuredClone(project);
  const item = next.timeline.tracks[0].items[0];
  if (!("RemotionGraphic" in item)) throw new Error("Invalid fixture");
  item.RemotionGraphic.props = { ...item.RemotionGraphic.props, title };
  return next;
}

function preview(project: Project, projectVersion: number) {
  return (
    <Preview
      project={project}
      projectVersion={projectVersion}
      playheadUs={500000}
      playing={false}
      onPlayingChange={vi.fn()}
      onPlayheadChange={vi.fn()}
    />
  );
}

function renderedVideo(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>(
    'video[src="/renders/first.webm"]',
  );
}

it("plays a graphic from its whole-card render once it is ready", async () => {
  const { project, itemId } = await titled("Ready");
  vi.mocked(invoke).mockResolvedValue({ path: "/renders/first.webm" });
  render(preview(project, 4));
  await waitFor(() => expect(renderedVideo()).toBeTruthy());
  expect(invoke).toHaveBeenCalledWith("get_graphic_playback", {
    itemId,
    revision: 4,
  });
  expect(renderedVideo()?.muted).toBe(true);
});

it("shows the live graphic while an edited card has not rendered yet", async () => {
  const { project } = await titled("Before");
  vi.mocked(invoke).mockResolvedValueOnce({ path: "/renders/first.webm" });
  const view = render(preview(project, 1));
  await waitFor(() => expect(renderedVideo()).toBeTruthy());
  vi.mocked(invoke).mockReturnValue(new Promise(() => {}));
  view.rerender(preview(retitled(project, "After"), 2));
  await waitFor(() => expect(screen.getByText("After")).toBeTruthy());
  expect(renderedVideo()).toBeNull();
  expect(invoke).toHaveBeenLastCalledWith(
    "get_graphic_playback",
    expect.objectContaining({ revision: 2 }),
  );
});

it("reuses the render again when an edit is undone", async () => {
  const { project } = await titled("Before");
  vi.mocked(invoke).mockResolvedValueOnce({ path: "/renders/first.webm" });
  const view = render(preview(project, 1));
  await waitFor(() => expect(renderedVideo()).toBeTruthy());
  vi.mocked(invoke).mockReturnValue(new Promise(() => {}));
  view.rerender(preview(retitled(project, "After"), 2));
  await waitFor(() => expect(renderedVideo()).toBeNull());
  view.rerender(preview(project, 3));
  await waitFor(() => expect(renderedVideo()).toBeTruthy());
});
