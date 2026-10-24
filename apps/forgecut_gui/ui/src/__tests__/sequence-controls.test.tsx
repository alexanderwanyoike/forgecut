import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  cleanupSequenceWorkspace,
  sequenceWorkspaceFixture,
} from "./sequence-workspace-fixture";
afterEach(cleanupSequenceWorkspace);

it("creates and selects a named sequence while retaining shared project content", async () => {
  const { state, App } = await sequenceWorkspaceFixture();
  render(<App />);
  await screen.findByLabelText("Text");
  const before = structuredClone(state.project);
  const revision = state.revision;
  fireEvent.click(screen.getByRole("button", { name: "New sequence" }));
  fireEvent.change(screen.getByLabelText("Sequence name"), {
    target: { value: "Standalone" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create sequence" }));
  await waitFor(() =>
    expect(
      state.project.sequences?.some(
        (sequence) => sequence.name === "Standalone",
      ),
    ).toBe(true),
  );
  const created = state.project.sequences!.find(
    (sequence) => sequence.name === "Standalone",
  )!;
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Active sequence") as HTMLSelectElement).value,
    ).toBe(created.id),
  );
  await screen.findByText("Project Settings");
  expect(created.settings).toEqual(before.settings);
  expect(state.project.timeline).toEqual(before.timeline);
  expect(state.project.assets).toEqual(before.assets);
  expect(
    state.project.sequences?.filter((sequence) => sequence.id !== created.id),
  ).toEqual(before.sequences);
  expect(state.revision).toBe(revision + 1);
});

it("renames the sequence chosen when the form opened even after active context changes", async () => {
  const { state, clip, App } = await sequenceWorkspaceFixture();
  render(<App />);
  await screen.findByLabelText("Text");
  fireEvent.click(screen.getByRole("button", { name: "Rename sequence" }));
  fireEvent.change(screen.getByLabelText("Sequence name"), {
    target: { value: "Main cut" },
  });
  await act(async () => {
    state.selectSequence(state.sessionId, clip);
  });
  await waitFor(() =>
    expect((screen.getByLabelText("Text") as HTMLInputElement).value).toBe(
      "Clip wording",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save sequence name" }));
  await waitFor(() =>
    expect(state.project.default_sequence?.name).toBe("Main cut"),
  );
  expect(state.project.sequences![0].name).toBe("Portrait clip");
  expect(state.getEditingContext().activeSequenceId).toBe(clip);
  expect(state.snapshot().undoSequenceId).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() =>
    expect(state.project.default_sequence?.name).toBe("Main"),
  );
  expect(state.getEditingContext().activeSequenceId).toBe(clip);
});

it("protects the default sequence and deletes another sequence with one-step undo", async () => {
  const { state, root, clip, App } = await sequenceWorkspaceFixture();
  render(<App />);
  await screen.findByLabelText("Text");
  expect(
    (
      screen.getByRole("button", {
        name: "Delete sequence",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  const before = structuredClone(state.project);
  fireEvent.change(screen.getByLabelText("Active sequence"), {
    target: { value: clip },
  });
  await waitFor(() =>
    expect((screen.getByLabelText("Text") as HTMLInputElement).value).toBe(
      "Clip wording",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete sequence" }));
  await waitFor(() => expect(state.project.sequences).toEqual([]));
  await waitFor(() =>
    expect((screen.getByLabelText("Text") as HTMLInputElement).value).toBe(
      "Root wording",
    ),
  );
  expect(state.getEditingContext().activeSequenceId).toBe(root);
  expect(state.getEditingContext().playheadUs).toBe(1000000);
  expect(state.project.timeline).toEqual(before.timeline);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(state.project).toEqual(before));
  expect(screen.getByRole("option", { name: "Portrait clip" })).toBeTruthy();
});

it("adds an audio track to an empty sequence without changing another timeline", async () => {
  const { state, App } = await sequenceWorkspaceFixture();
  render(<App />);
  await screen.findByLabelText("Text");
  const rootTimeline = structuredClone(state.project.timeline);
  fireEvent.click(screen.getByRole("button", { name: "New sequence" }));
  fireEvent.change(screen.getByLabelText("Sequence name"), {
    target: { value: "Audio clip" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create sequence" }));
  await screen.findByText("Project Settings");
  fireEvent.change(screen.getByLabelText("New track type"), {
    target: { value: "Audio" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add track" }));
  await waitFor(() =>
    expect(
      state.project.sequences!.find(
        (sequence) => sequence.name === "Audio clip",
      )?.timeline.tracks,
    ).toMatchObject([{ kind: "Audio", items: [] }]),
  );
  expect(state.project.timeline).toEqual(rootTimeline);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() =>
    expect(
      state.project.sequences!.find(
        (sequence) => sequence.name === "Audio clip",
      )?.timeline.tracks,
    ).toEqual([]),
  );
});
