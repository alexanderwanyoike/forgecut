import { URL as NodeURL } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Timeline from "../components/Timeline";
import Inspector from "../components/Inspector";
import { AppState } from "../../electron/backend/state";
import { EditingService } from "../../electron/backend/editing-service";

vi.mock("../lib/bridge", () => ({
  invoke: vi.fn().mockResolvedValue(null),
  invokeGrouped: vi.fn().mockResolvedValue(null),
  mediaUrl: (path: string) => path,
}));
vi.stubGlobal("URL", NodeURL);
afterEach(() => cleanup());
it("names and selects a pinned graphic instance in the timeline and Inspector", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  expect(
    await service.execute("add_graphic_item", {
      templateId: "title-card",
      trackId: "graphics",
      timelineStartUs: 0,
      durationUs: 2000000,
      props: { title: "Octane" },
    }),
  ).toMatchObject({ ok: true });
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
        playheadUs={0}
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
  const label = screen.getByText("Octane");
  expect(screen.getByText("G1")).toBeTruthy();
  expect(screen.getByText("Title card")).toBeTruthy();
  fireEvent.mouseDown(label, { clientX: 100, clientY: 100 });
  expect(select).toHaveBeenCalledWith(item.RemotionGraphic.id);
});
