import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import titleSource from "../../electron/graphics/TitleCard.tsx?raw";
import { AppState } from "../../electron/backend/state";
import { EditingService } from "../../electron/backend/editing-service";
import Preview from "../components/Preview";
import type { VisualPlacement } from "../../electron/shared/ipc-contract";
import { invoke } from "../lib/bridge";
vi.mock("node:fs", () => ({
  readFileSync: () => titleSource,
  default: { readFileSync: () => titleSource },
}));
vi.mock("../lib/bridge", () => ({
  invoke: vi.fn().mockResolvedValue({}),
  mediaUrl: (path: string) => path,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const titleId = "3aa35212-adf2-46b6-b406-2c4b1bb4f93a";
async function fixture(
  settings?: { width: number; height: number },
  transform?: VisualPlacement,
) {
  const state = new AppState();
  const service = new EditingService(state);
  if (settings) await service.execute("update_project", { settings });
  await service.execute("add_graphic_item", {
    templateId: "title-card",
    trackId: "graphics",
    timelineStartUs: 0,
    durationUs: 2000000,
    props: { title: "After dark", entrance_frames: 0 },
  });
  const item = state.project.timeline.tracks[0].items[0];
  if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
  if (transform) {
    await service.execute("update_item", {
      itemId: item.RemotionGraphic.id,
      patch: { kind: "RemotionGraphic", changes: { transform } },
    });
  }
  const props = {
    project: state.project,
    projectVersion: state.revision,
    sessionId: state.sessionId,
    selectedClipId: item.RemotionGraphic.id,
    selectedLayerId: titleId,
    onGraphicSelection: vi.fn(),
    playheadUs: 0,
    playing: false,
    onPlayingChange: vi.fn(),
    onPlayheadChange: vi.fn(),
  };
  const view = render(<Preview {...props} />);
  const target = await screen.findByRole("button", { name: "Select Title" });
  const stage = target.closest("[data-graphic-stage]");
  if (!stage) throw new Error("Missing stage");
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
    left: 20,
    top: 40,
    width: 960,
    height: 540,
    right: 980,
    bottom: 580,
    x: 20,
    y: 40,
    toJSON: () => ({}),
  });
  return { view, props, target, item: item.RemotionGraphic };
}
it("drags in composition coordinates and commits one guarded history action", async () => {
  const { target, props, item } = await fixture();
  fireEvent.mouseDown(target, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.mouseMove(window, { clientX: 150, clientY: 125 });
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.mouseUp(window, { clientX: 150, clientY: 125 });
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      "apply_edits",
      expect.objectContaining({
        sessionId: props.sessionId,
        expectedRevision: props.projectVersion,
        operations: [
          {
            command: "update_item",
            args: {
              itemId: item.id,
              patch: {
                kind: "RemotionGraphic",
                changes: { props: { title_x: 250, title_y: 470 } },
              },
            },
          },
        ],
      }),
    ),
  );
});
it("cancels a gesture with Escape or a changed project revision", async () => {
  const { target, view, props } = await fixture();
  fireEvent.mouseDown(target, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.mouseMove(window, { clientX: 150, clientY: 125 });
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.mouseUp(window);
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.mouseDown(target, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.mouseMove(window, { clientX: 150, clientY: 125 });
  view.rerender(
    <Preview {...props} projectVersion={props.projectVersion + 1} />,
  );
  fireEvent.mouseUp(window);
  expect(invoke).not.toHaveBeenCalled();
});

it("resizes through a nested portrait placement independently of display pixel ratio", async () => {
  const previousRatio = window.devicePixelRatio;
  Object.defineProperty(window, "devicePixelRatio", {
    value: 2,
    configurable: true,
  });
  const { target, item } = await fixture(
    { width: 1080, height: 1920 },
    { x: 123, y: 72, width: 540, height: 960, opacity: 1, fit: "cover" },
  );
  const stage = target.closest("[data-graphic-stage]")!;
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 60,
    width: 270,
    height: 480,
    right: 370,
    bottom: 540,
    x: 100,
    y: 60,
    toJSON: () => ({}),
  });
  fireEvent.mouseDown(screen.getByRole("button", { name: "Resize Title" }), {
    button: 0,
    clientX: 300,
    clientY: 400,
  });
  fireEvent.mouseMove(window, { clientX: 325, clientY: 450 });
  fireEvent.mouseUp(window);
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      "apply_edits",
      expect.objectContaining({
        operations: [
          {
            command: "update_item",
            args: {
              itemId: item.id,
              patch: {
                kind: "RemotionGraphic",
                changes: {
                  props: {
                    title_width: Number(item.props.title_width) + 100,
                    title_height: Number(item.props.title_height) + 200,
                  },
                },
              },
            },
          },
        ],
      }),
    ),
  );
  Object.defineProperty(window, "devicePixelRatio", {
    value: previousRatio,
    configurable: true,
  });
});
it("nudges by one composition pixel or ten with Shift", async () => {
  const { target, item } = await fixture();
  fireEvent.keyDown(target, { key: "ArrowRight", shiftKey: true });
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      "apply_edits",
      expect.objectContaining({
        operations: [
          {
            command: "update_item",
            args: {
              itemId: item.id,
              patch: {
                kind: "RemotionGraphic",
                changes: { props: { title_x: 160, title_y: 420 } },
              },
            },
          },
        ],
      }),
    ),
  );
});
it("keeps an active drag through a preview redraw at the same project revision", async () => {
  const { target, view, props } = await fixture();
  fireEvent.mouseDown(target, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.mouseMove(window, { clientX: 150, clientY: 125 });
  view.rerender(
    <Preview {...props} project={structuredClone(props.project)} />,
  );
  fireEvent.mouseMove(window, { clientX: 160, clientY: 130 });
  fireEvent.mouseUp(window, { clientX: 160, clientY: 130 });
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      "apply_edits",
      expect.objectContaining({
        expectedRevision: props.projectVersion,
        operations: [
          expect.objectContaining({
            args: expect.objectContaining({
              patch: {
                kind: "RemotionGraphic",
                changes: { props: { title_x: 270, title_y: 480 } },
              },
            }),
          }),
        ],
      }),
    ),
  );
});
it("removes the transient drag position when the project revision changes", async () => {
  const { target, view, props } = await fixture();
  fireEvent.mouseDown(target, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.mouseMove(window, { clientX: 150, clientY: 125 });
  expect(target.parentElement?.style.left).toBe("250px");
  view.rerender(
    <Preview {...props} projectVersion={props.projectVersion + 1} />,
  );
  await waitFor(() => expect(target.parentElement?.style.left).toBe("150px"));
  fireEvent.mouseUp(window);
  expect(invoke).not.toHaveBeenCalled();
});
