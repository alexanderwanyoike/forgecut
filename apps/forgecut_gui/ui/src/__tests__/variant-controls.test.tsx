import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { itemData } from "../../electron/domain/timeline-item";
import {
  cleanupSequenceWorkspace,
  sequenceWorkspaceFixture,
} from "./sequence-workspace-fixture";

afterEach(cleanupSequenceWorkspace);

it("creates a portrait copy from the visible sequence and selects its independent timeline", async () => {
  const { state, root, App } = await sequenceWorkspaceFixture();
  render(<App />);
  await screen.findByLabelText("Text");
  const before = structuredClone(state.project.timeline);
  fireEvent.click(
    screen.getByRole("button", { name: "Create sequence variant" }),
  );
  fireEvent.change(screen.getByLabelText("Sequence name"), {
    target: { value: "Trailer portrait" },
  });
  fireEvent.change(screen.getByLabelText("Variant format"), {
    target: { value: "portrait" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create variant" }));
  await waitFor(() =>
    expect(
      state.project.sequences?.some(
        (sequence) => sequence.name === "Trailer portrait",
      ),
    ).toBe(true),
  );
  const variant = state.project.sequences!.find(
    (sequence) => sequence.name === "Trailer portrait",
  )!;
  expect(variant).toMatchObject({
    variant_source: { sequence_id: root },
    settings: { width: 1080, height: 1920 },
  });
  expect(itemData(variant.timeline.tracks[0].items[0])).toMatchObject({
    origin_item_id: itemData(before.tracks[0].items[0]).id,
  });
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Active sequence") as HTMLSelectElement).value,
    ).toBe(variant.id),
  );
  await screen.findByText("Project Settings");
  expect((screen.getByLabelText("Width") as HTMLInputElement).value).toBe(
    "1080",
  );
  expect(state.project.timeline).toEqual(before);
});

it("syncs selected variant timing without replacing manual wording and undoes only that sync", async () => {
  const { state, root, service, App } = await sequenceWorkspaceFixture();
  const copied = await service.execute("create_sequence_variant", {
    sourceSequenceId: root,
    name: "Portrait",
    settings: { width: 360, height: 640 },
  });
  expect(copied).toMatchObject({ ok: true });
  const variant = state.project.sequences!.find(
    (sequence) => sequence.name === "Portrait",
  )!;
  const targetItem = itemData(variant.timeline.tracks[0].items[0]);
  const sourceItem = itemData(state.project.timeline.tracks[0].items[0]);
  expect(
    await service.execute(
      "update_item",
      {
        itemId: targetItem.id,
        patch: { kind: "TextOverlay", changes: { text: "My manual title" } },
      },
      { sessionId: state.sessionId, sequenceId: variant.id },
    ),
  ).toMatchObject({ ok: true });
  expect(
    await service.execute(
      "move_clip",
      { itemId: sourceItem.id, newStartUs: 2000000 },
      { sessionId: state.sessionId, sequenceId: root },
    ),
  ).toMatchObject({ ok: true });
  state.selectSequence(state.sessionId, variant.id);
  state.setEditingContext({
    sessionId: state.sessionId,
    sequenceId: variant.id,
    selectedItemIds: [targetItem.id],
    playheadUs: 0,
  });
  render(<App />);
  await waitFor(() =>
    expect((screen.getByLabelText("Text") as HTMLInputElement).value).toBe(
      "My manual title",
    ),
  );
  const source = structuredClone(state.project.timeline);
  fireEvent.click(screen.getByRole("button", { name: "Sync timing" }));
  await waitFor(() =>
    expect(
      itemData(
        state.project.sequences!.find((sequence) => sequence.id === variant.id)!
          .timeline.tracks[0].items[0],
      ).timeline_start_us,
    ).toBe(2000000),
  );
  expect((screen.getByLabelText("Text") as HTMLInputElement).value).toBe(
    "My manual title",
  );
  expect(state.project.timeline).toEqual(source);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() =>
    expect(
      itemData(
        state.project.sequences!.find((sequence) => sequence.id === variant.id)!
          .timeline.tracks[0].items[0],
      ).timeline_start_us,
    ).toBe(0),
  );
  expect(state.project.timeline).toEqual(source);
});

it("cancels a delayed variant action when its original project is replaced", async () => {
  const { state, App } = await sequenceWorkspaceFixture();
  render(<App />);
  await screen.findByLabelText("Text");
  fireEvent.click(
    screen.getByRole("button", { name: "Create sequence variant" }),
  );
  const native = window.forgecut!.invoke;
  let switched = false;
  window.forgecut!.invoke = async <T,>(...input: Parameters<typeof native>) => {
    const [command] = input;
    const response = await native<T>(...input);
    if (command === "get_project_snapshot" && !switched) {
      switched = true;
      await act(async () => {
        state.createProject();
      });
    }
    return response;
  };
  fireEvent.click(screen.getByRole("button", { name: "Create variant" }));
  await waitFor(() => expect(switched).toBe(true));
  await screen.findByText("Project Settings");
  expect(state.project.name).toBe("Untitled");
  expect(state.project.sequences).toEqual([]);
});
