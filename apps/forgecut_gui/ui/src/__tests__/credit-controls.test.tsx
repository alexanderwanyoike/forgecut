import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  cleanupSequenceWorkspace,
  sequenceWorkspaceFixture,
} from "./sequence-workspace-fixture";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true;
    },
  });
});
afterEach(async () => {
  await cleanupSequenceWorkspace();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});

async function fixture() {
  const value = await sequenceWorkspaceFixture();
  value.state.executeProjectChange((project) => {
    project.assets.push({
      id: "music",
      name: "Low-profile heartbeat",
      path: "/music.ogg",
      kind: "Audio",
      probe: null,
    });
  });
  render(<value.App />);
  await screen.findByLabelText("Text");
  fireEvent.click(screen.getByRole("button", { name: "File", exact: true }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Project credits" }),
  );
  await screen.findByRole("dialog", { name: "Project credits" });
  return value;
}

it("saves a music credit from the project menu and restores it through project undo", async () => {
  const { state, service } = await fixture();
  const before = structuredClone(state.project);
  fireEvent.change(screen.getByLabelText("Licence / permission"), {
    target: { value: "Supplied music" },
  });
  fireEvent.change(screen.getByLabelText("Attribution"), {
    target: { value: "Signal Transit / Low-profile heartbeat" },
  });
  fireEvent.change(screen.getByLabelText("Source URL"), {
    target: { value: "https://example.com/music" },
  });
  fireEvent.change(screen.getByLabelText("Licence notice"), {
    target: { value: "Permission supplied with this project" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save credits" }));
  await waitFor(() =>
    expect(state.project.assets[0].license).toEqual({
      identifier: "Supplied music",
      attribution: "Signal Transit / Low-profile heartbeat",
      source_url: "https://example.com/music",
      text: "Permission supplied with this project",
    }),
  );
  expect(state.project.timeline).toEqual(before.timeline);
  expect(state.project.sequences).toEqual(before.sequences);
  expect(state.snapshot().undoSequenceId).toBeUndefined();
  expect(
    screen.queryByText("Credits changed elsewhere. Reload before saving."),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Close project credits" }),
  );
  expect(screen.queryByRole("dialog", { name: "Project credits" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(state.project).toEqual(before));
  expect(await service.execute("redo")).toMatchObject({ ok: true });
});
