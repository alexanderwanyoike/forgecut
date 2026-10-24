import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
    project.resources!.push({
      id: "00000000-0000-4000-8000-000000000051",
      name: "Project font",
      kind: "Font",
      mime: "font/ttf",
      sha256: "a".repeat(64),
      path: `.forgecut-resources/${"a".repeat(64)}`,
      license: { identifier: "OFL-1.1", text: "Original font notice" },
    });
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
  await act(async () => {
    expect(await service.execute("redo")).toMatchObject({ ok: true });
  });
});

it("updates a font attribution while retaining the imported font identity and notice", async () => {
  const { state } = await fixture();
  const original = structuredClone(state.project.resources![0]);
  expect(
    screen.getByRole("option", { name: "Project font · Font" }),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Credit for"), {
    target: { value: original.id },
  });
  expect(
    (screen.getByLabelText("Licence / permission") as HTMLInputElement).value,
  ).toBe("OFL-1.1");
  fireEvent.change(screen.getByLabelText("Attribution"), {
    target: { value: "Font designer" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save credits" }));
  await waitFor(() =>
    expect(state.project.resources![0]).toEqual({
      ...original,
      license: { ...original.license, attribution: "Font designer" },
    }),
  );
});

it("explicitly removes an asset credit and restores it with global undo", async () => {
  const { state, service } = await fixture();
  fireEvent.change(screen.getByLabelText("Licence / permission"), {
    target: { value: "Original recording" },
  });
  fireEvent.change(screen.getByLabelText("Licence notice"), {
    target: { value: "Recorded by the project editor" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save credits" }));
  await waitFor(() =>
    expect(state.project.assets[0].license?.identifier).toBe(
      "Original recording",
    ),
  );
  const before = structuredClone(state.project);
  fireEvent.click(screen.getByRole("button", { name: "Remove credit" }));
  await waitFor(() => expect(state.project.assets[0].license).toBeUndefined());
  await act(async () => {
    await service.execute("undo");
  });
  expect(state.project).toEqual(before);
});

it("keeps a manual credit draft when an agent changes the same metadata and requires explicit reload", async () => {
  const { state, service } = await fixture();
  fireEvent.change(screen.getByLabelText("Licence / permission"), {
    target: { value: "Manual permission" },
  });
  fireEvent.change(screen.getByLabelText("Licence notice"), {
    target: { value: "Manual notice" },
  });
  const license = {
    identifier: "Agent metadata",
    text: "Agent notice",
    attribution: "Agent credit",
  };
  await act(async () => {
    await service.execute("set_asset_license", { assetId: "music", license });
  });
  await screen.findByText("Credits changed elsewhere. Reload before saving.");
  expect(
    (screen.getByLabelText("Licence / permission") as HTMLInputElement).value,
  ).toBe("Manual permission");
  expect(
    (screen.getByRole("button", { name: "Save credits" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Reload credits" }));
  expect((screen.getByLabelText("Attribution") as HTMLInputElement).value).toBe(
    "Agent credit",
  );
  fireEvent.change(screen.getByLabelText("Attribution"), {
    target: { value: "Reviewed credit" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save credits" }));
  await waitFor(() =>
    expect(state.project.assets[0].license?.attribution).toBe(
      "Reviewed credit",
    ),
  );
  expect(
    screen.queryByText("Credits changed elsewhere. Reload before saving."),
  ).toBeNull();
  expect(
    (screen.getByRole("button", { name: "Save credits" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

it("keeps the credit draft visible and blocks saving when its media is removed", async () => {
  const { service } = await fixture();
  fireEvent.change(screen.getByLabelText("Licence / permission"), {
    target: { value: "Manual permission" },
  });
  fireEvent.change(screen.getByLabelText("Licence notice"), {
    target: { value: "Manual notice" },
  });
  await act(async () => {
    await service.execute("remove_asset", { id: "music" });
  });
  await screen.findByText(
    "This media is no longer available. Choose another credit above.",
  );
  expect(
    (screen.getByLabelText("Licence / permission") as HTMLInputElement).value,
  ).toBe("Manual permission");
  expect(
    (screen.getByRole("button", { name: "Save credits" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
