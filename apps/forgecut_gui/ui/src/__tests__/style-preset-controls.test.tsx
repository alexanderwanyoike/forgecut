import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

it("replaces a saved look from the current graphic and undoes it without changing existing timeline items", async () => {
  const { state, service, source, root, App } = await styleFixture();
  await service.execute("save_style_preset", {
    sourceSequenceId: root,
    itemId: source.id,
    name: "Project card",
    purpose: "card",
  });
  const preset = state.project.style_presets![0];
  render(<App />);
  await screen.findByLabelText("Title");
  fireEvent.click(screen.getByRole("button", { name: "Save project style" }));
  fireEvent.change(await screen.findByLabelText("Style destination"), {
    target: { value: preset.id },
  });
  await act(async () => {
    expect(
      await service.execute(
        "update_item",
        {
          itemId: source.id,
          patch: {
            kind: "RemotionGraphic",
            changes: { props: { color: "#aabbcc" } },
          },
        },
        { sessionId: state.sessionId, sequenceId: root },
      ),
    ).toMatchObject({ ok: true });
  });
  const before = state.snapshot();
  fireEvent.change(screen.getByLabelText("Style name"), {
    target: { value: "Updated card" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Replace style" }));
  await waitFor(() =>
    expect(state.project.style_presets![0].props.color).toBe("#aabbcc"),
  );
  expect(state.project.style_presets).toHaveLength(1);
  expect(state.project.style_presets![0]).toMatchObject({
    id: preset.id,
    name: "Updated card",
  });
  expect(state.project.timeline).toEqual(before.project.timeline);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(state.project).toEqual(before.project));
});

it("deletes a saved style from the timeline picker without selecting a graphic and restores it with undo", async () => {
  const { state, service, source, root, App } = await styleFixture();
  await service.execute("save_style_preset", {
    sourceSequenceId: root,
    itemId: source.id,
    name: "Project card",
    purpose: "card",
  });
  const preset = state.project.style_presets![0];
  state.setEditingContext({
    sessionId: state.sessionId,
    sequenceId: root,
    selectedItemIds: [],
    playheadUs: 3000000,
  });
  const before = state.snapshot();
  render(<App />);
  await screen.findByLabelText("Name");
  fireEvent.change(screen.getByLabelText("Graphic template"), {
    target: { value: `style:${preset.id}` },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Delete style: Project card" }),
  );
  await waitFor(() => expect(state.project.style_presets).toEqual([]));
  expect(state.project.timeline).toEqual(before.project.timeline);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(state.project).toEqual(before.project));
});
