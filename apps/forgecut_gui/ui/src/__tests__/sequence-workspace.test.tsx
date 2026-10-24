import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppState } from "../../electron/backend/state";
import { EditingService } from "../../electron/backend/editing-service";
import type {
  CommandMetadata,
  CommandResponse,
} from "../../electron/shared/ipc-contract";

let service: EditingService | undefined;
afterEach(async () => {
  cleanup();
  delete window.forgecut;
  if (service) {
    await service.jobs.close();
    await service.closeGraphicsPreview();
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

async function fixture() {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const state = new AppState();
  service = new EditingService(state);
  const owner = service;
  const text = (trackId: string, value: string) => ({
    trackId,
    timelineStartUs: 0,
    durationUs: 3000000,
    text: value,
    fontSize: 48,
    color: "#ffffff",
    x: 20,
    y: 50,
  });
  expect(
    await owner.execute("add_text_overlay", text("root-text", "Root wording")),
  ).toMatchObject({ ok: true });
  expect(
    await owner.execute("create_sequence", {
      name: "Portrait clip",
      settings: { width: 360, height: 640, fps: 10 },
    }),
  ).toMatchObject({ ok: true });
  const root = state.project.default_sequence!.id;
  const clip = state.project.sequences![0].id;
  expect(
    await owner.execute("apply_edits", {
      sessionId: state.sessionId,
      expectedRevision: state.revision,
      requestId: crypto.randomUUID(),
      sequenceId: clip,
      operations: [
        {
          command: "add_text_overlay",
          args: text("clip-text", "Clip wording"),
        },
      ],
    }),
  ).toMatchObject({ ok: true });
  const rootItem = state.project.timeline.tracks[0].items[0].TextOverlay!.id;
  const clipItem =
    state.project.sequences![0].timeline.tracks[0].items[0].TextOverlay!.id;
  state.selectSequence(state.sessionId, clip);
  state.setEditingContext({
    sessionId: state.sessionId,
    sequenceId: clip,
    selectedItemIds: [clipItem],
    playheadUs: 250000,
  });
  state.selectSequence(state.sessionId, root);
  state.setEditingContext({
    sessionId: state.sessionId,
    sequenceId: root,
    selectedItemIds: [rootItem],
    playheadUs: 1000000,
  });
  window.forgecut = {
    invoke: async <T,>(
      command: string,
      args?: Record<string, unknown>,
      metadata?: CommandMetadata,
    ): Promise<CommandResponse<T>> =>
      owner.execute(command, args, metadata) as Promise<CommandResponse<T>>,
    events: {
      listen: <T,>(
        event: string,
        callback: (message: { event: string; payload: T }) => void,
      ) =>
        state.subscribe((snapshot) => {
          if (event === "project-changed")
            callback({ event, payload: snapshot as T });
        }),
    },
    mcp: {
      status: vi
        .fn()
        .mockResolvedValue({
          available: true,
          statusRevision: 1,
          lastAction: null,
        }),
    },
    dialog: { open: vi.fn(), save: vi.fn() },
    window: {
      scaleFactor: vi.fn().mockResolvedValue(1),
      onMoved: vi.fn().mockResolvedValue(() => {}),
      onResized: vi.fn().mockResolvedValue(() => {}),
    },
    mediaUrl: (path) => path,
  };
  const { default: App } = await import("../App");
  return { state, root, clip, rootItem, clipItem, App };
}

it("switches every editing surface and restores each sequence context without creative edits", async () => {
  const { state, root, clip, App } = await fixture();
  const revision = state.revision;
  const view = render(<App />);
  const picker = await screen.findByLabelText("Active sequence");
  await waitFor(() =>
    expect((screen.getByLabelText("Text") as HTMLInputElement).value).toBe(
      "Root wording",
    ),
  );
  expect(state.getEditingContext().playheadUs).toBe(1000000);
  fireEvent.change(picker, { target: { value: clip } });
  await waitFor(() =>
    expect((screen.getByLabelText("Text") as HTMLInputElement).value).toBe(
      "Clip wording",
    ),
  );
  expect(state.getEditingContext().playheadUs).toBe(250000);
  expect(state.revision).toBe(revision);
  expect(
    view.container.querySelector<HTMLElement>(".preview-composition")?.style
      .width,
  ).toBe("360px");
  expect(view.container.querySelector(".clip-label")?.textContent).toBe(
    "Clip wording",
  );
  const input = screen.getByLabelText("Text");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "Manual clip wording" } });
  fireEvent.blur(input);
  await waitFor(() =>
    expect(
      state.project.sequences![0].timeline.tracks[0].items[0].TextOverlay!.text,
    ).toBe("Manual clip wording"),
  );
  expect(state.project.timeline.tracks[0].items[0].TextOverlay!.text).toBe(
    "Root wording",
  );
  fireEvent.change(picker, { target: { value: root } });
  await waitFor(() =>
    expect((screen.getByLabelText("Text") as HTMLInputElement).value).toBe(
      "Root wording",
    ),
  );
  expect(state.getEditingContext().playheadUs).toBe(1000000);
  expect(
    (screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    view.container.querySelector<HTMLElement>(".preview-composition")?.style
      .width,
  ).toBe("1920px");
});
