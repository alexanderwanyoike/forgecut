import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import titleSource from "../../electron/graphics/TitleCard.tsx?raw";
import Timeline from "../components/Timeline";
import Inspector from "../components/Inspector";
import { AppState } from "../../electron/backend/state";
import { EditingService } from "../../electron/backend/editing-service";
import { createPlayhead } from "../lib/playhead";

vi.mock("../lib/bridge", () => ({
  invoke: vi.fn().mockResolvedValue(null),
  invokeGrouped: vi.fn().mockResolvedValue(null),
  mediaUrl: (path: string) => path,
}));
vi.mock("node:fs", () => {
  const mocked = { readFileSync: () => titleSource };
  return { ...mocked, default: mocked };
});
afterEach(() => cleanup());
it("names and selects a pinned graphic instance in the timeline and Inspector", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  const created = await service.execute("add_graphic_item", {
    templateId: "title-card",
    trackId: "graphics",
    timelineStartUs: 0,
    durationUs: 2000000,
    props: { title: "Octane" },
  });
  if (!created.ok) throw new Error(created.error.message);
  const item = state.project.timeline.tracks[0].items[0];
  if (!("RemotionGraphic" in item)) throw new Error("Invalid graphic fixture");
  const select = vi.fn();
  render(
    <>
      <Timeline
        projectTimeline={state.project.timeline}
        projectVersion={state.revision}
        selectedClipId={item.RemotionGraphic.id}
        onSelectedClipChange={select}
        playhead={createPlayhead(0)}
        playing={false}
        onPlayingChange={() => {}}
        onPlayheadChange={() => {}}
      />
      <Inspector
        project={state.project}
        selectedClipId={item.RemotionGraphic.id}
      />
    </>,
  );
  const label = screen.getByText("Octane", { selector: ".clip-label" });
  expect(screen.getByText("G1")).toBeTruthy();
  expect(screen.getAllByText("Title card").length).toBeGreaterThan(0);
  fireEvent.mouseDown(label, { clientX: 100, clientY: 100 });
  expect(select).toHaveBeenCalledWith(item.RemotionGraphic.id);
});
