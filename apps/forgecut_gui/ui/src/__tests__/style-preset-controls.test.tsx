import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanupSequenceWorkspace,
  sequenceWorkspaceFixture,
} from "./sequence-workspace-fixture";

import titleSource from "../../electron/graphics/TitleCard.tsx?raw";
vi.mock("node:fs", () => ({
  readFileSync: () => titleSource,
  default: { readFileSync: () => titleSource },
}));
afterEach(cleanupSequenceWorkspace);
async function styleFixture() {
  const fixture = await sequenceWorkspaceFixture();
  const added = await fixture.service.execute(
    "add_graphic_item",
    {
      templateId: "title-card",
      trackId: "root-graphics",
      timelineStartUs: 0,
      durationUs: 1000000,
      props: { title: "Muted title", color: "#8293a4" },
    },
    { sessionId: fixture.state.sessionId, sequenceId: fixture.root },
  );
  expect(added, JSON.stringify(added)).toMatchObject({ ok: true });
  const source = fixture.state.project.timeline.tracks
    .flatMap((track) => track.items)
    .find((item) => "RemotionGraphic" in item);
  if (!source || !("RemotionGraphic" in source))
    throw new Error("Missing card");
  fixture.state.setEditingContext({
    sessionId: fixture.state.sessionId,
    sequenceId: fixture.root,
    selectedItemIds: [source.RemotionGraphic.id],
    playheadUs: 3000000,
  });
  return { ...fixture, source: source.RemotionGraphic };
}

it("saves the selected graphic as a project style and adds an independent copy from the timeline picker", async () => {
  const { state, source, App } = await styleFixture();
  render(<App />);
  await screen.findByLabelText("Title");
  fireEvent.click(screen.getByRole("button", { name: "Save project style" }));
  fireEvent.change(await screen.findByLabelText("Style name"), {
    target: { value: "Octane card" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create style" }));
  await waitFor(() => expect(state.project.style_presets).toHaveLength(1));
  const preset = state.project.style_presets![0];
  expect(preset.name).toBe("Octane card");
  expect(preset.props).toEqual(source.props);
  fireEvent.change(screen.getByLabelText("Graphic template"), {
    target: { value: `style:${preset.id}` },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add graphic" }));
  await waitFor(() =>
    expect(
      state.project.timeline.tracks
        .flatMap((track) => track.items)
        .filter((item) => "RemotionGraphic" in item),
    ).toHaveLength(2),
  );
  const copy = state.project.timeline.tracks
    .flatMap((track) => track.items)
    .find(
      (item) =>
        "RemotionGraphic" in item && item.RemotionGraphic.id !== source.id,
    );
  expect(copy).toMatchObject({
    RemotionGraphic: {
      timeline_start_us: 3000000,
      component_version: preset.component_version,
      props: source.props,
    },
  });
  expect(state.project.style_presets![0]).toEqual(preset);
});
