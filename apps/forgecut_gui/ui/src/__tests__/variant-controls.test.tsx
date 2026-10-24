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
