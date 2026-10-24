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
async function fixture() {
  const state = new AppState();
  const service = new EditingService(state);
  await service.execute("add_graphic_item", {
    templateId: "title-card",
    trackId: "graphics",
    timelineStartUs: 0,
    durationUs: 2000000,
    props: { title: "After dark", entrance_frames: 0 },
  });
  const item = state.project.timeline.tracks[0].items[0];
  if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
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
