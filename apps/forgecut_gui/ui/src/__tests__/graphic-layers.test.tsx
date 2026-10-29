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
import Inspector from "../components/Inspector";
import { invokeGrouped } from "../lib/bridge";
vi.mock("node:fs", () => ({
  readFileSync: () => titleSource,
  default: { readFileSync: () => titleSource },
}));
vi.mock("../lib/bridge", () => ({
  invoke: vi.fn().mockResolvedValue({}),
  invokeGrouped: vi.fn().mockResolvedValue({}),
  mediaUrl: (path: string) => path,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("selects a layer and edits visibility locking and order without changing source", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  await service.execute("add_graphic_item", {
    templateId: "title-card",
    trackId: "graphics",
    timelineStartUs: 0,
    durationUs: 1000000,
  });
  const item = state.project.timeline.tracks[0].items[0];
  if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
  const titleId = state.project.components![0].layers[1].id;
  const select = vi.fn();
  render(
    <Inspector
      project={state.project}
      selectedClipId={item.RemotionGraphic.id}
      selectedLayerId={titleId}
      onSelectedLayerChange={select}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Select Artwork layer" }));
  expect(select).toHaveBeenCalledWith(
    state.project.components![0].layers[0].id,
  );
  fireEvent.click(screen.getByLabelText("Show Title"));
  await waitFor(() =>
    expect(invokeGrouped).toHaveBeenCalledWith(
      expect.any(String),
      "update_item",
      {
        itemId: item.RemotionGraphic.id,
        patch: {
          kind: "RemotionGraphic",
          changes: { layer_states: { [titleId]: { hidden: true } } },
        },
      },
    ),
  );
  fireEvent.click(screen.getByLabelText("Lock Title"));
  await waitFor(() =>
    expect(invokeGrouped).toHaveBeenCalledWith(
      expect.any(String),
      "update_item",
      expect.objectContaining({
        patch: {
          kind: "RemotionGraphic",
          changes: { layer_states: { [titleId]: { locked: true } } },
        },
      }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Move Title backward" }));
  await waitFor(() =>
    expect(invokeGrouped).toHaveBeenCalledWith(
      expect.any(String),
      "update_item",
      expect.objectContaining({
        patch: {
          kind: "RemotionGraphic",
          changes: {
            layer_states: expect.objectContaining({
              [titleId]: expect.objectContaining({ order: 0 }),
            }),
          },
        },
      }),
    ),
  );
});

it("disables locked bindings even when viewing all properties", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  await service.execute("add_graphic_item", {
    templateId: "title-card",
    trackId: "graphics",
    timelineStartUs: 0,
    durationUs: 1000000,
  });
  const item = state.project.timeline.tracks[0].items[0];
  if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
  await service.execute("update_item", {
    itemId: item.RemotionGraphic.id,
    patch: {
      kind: "RemotionGraphic",
      changes: {
        layer_states: {
          [state.project.components![0].layers[1].id]: { locked: true },
        },
      },
    },
  });
  render(
    <Inspector
      project={state.project}
      selectedClipId={item.RemotionGraphic.id}
    />,
  );
  expect(
    (
      screen
        .getByLabelText("Alignment")
        .closest("fieldset") as HTMLFieldSetElement
    ).disabled,
  ).toBe(true);
  expect(
    (screen.getByLabelText("Title").closest("fieldset") as HTMLFieldSetElement)
      .disabled,
  ).toBe(true);
  expect(
    (
      screen
        .getByLabelText("Background opacity")
        .closest("fieldset") as HTMLFieldSetElement
    ).disabled,
  ).toBe(false);
});

it("preserves a newer change to another layer when a stale panel toggles visibility", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  await service.execute("add_graphic_item", {
    templateId: "title-card",
    trackId: "graphics",
    timelineStartUs: 0,
    durationUs: 1000000,
  });
  const item = state.project.timeline.tracks[0].items[0];
  if (!("RemotionGraphic" in item)) throw new Error("Missing graphic");
  const artwork = state.project.components![0].layers[0].id;
  await service.execute("update_item", {
    itemId: item.RemotionGraphic.id,
    patch: {
      kind: "RemotionGraphic",
      changes: { layer_states: { [artwork]: { hidden: false } } },
    },
  });
  render(
    <Inspector
      project={state.project}
      selectedClipId={item.RemotionGraphic.id}
    />,
  );
  await service.execute("update_item", {
    itemId: item.RemotionGraphic.id,
    patch: {
      kind: "RemotionGraphic",
      changes: { layer_states: { [artwork]: { hidden: true } } },
    },
  });
  vi.mocked(invokeGrouped).mockImplementationOnce(
    async (_group, command, args) => {
      const result = await service.execute(command, args);
      if (!result.ok) throw new Error(result.error.message);
      return result.value as never;
    },
  );
  fireEvent.click(screen.getByLabelText("Show Title"));
  await waitFor(() => {
    const current = state.project.timeline.tracks[0].items[0];
    if (!("RemotionGraphic" in current)) throw new Error("Missing graphic");
    expect(current.RemotionGraphic.layer_states?.[artwork].hidden).toBe(true);
    expect(
      current.RemotionGraphic.layer_states?.[
        state.project.components![0].layers[1].id
      ].hidden,
    ).toBe(true);
  });
});
