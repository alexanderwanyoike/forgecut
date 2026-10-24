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
      status: vi.fn().mockResolvedValue({
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

it("creates and selects a named sequence while retaining shared project content", async () => {
  const { state, App } = await fixture();
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
  const { state, clip, App } = await fixture();
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
  const { state, root, clip, App } = await fixture();
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

it("ignores a delayed context reply after the visible sequence has changed", async () => {
  const { state, root, clip, App } = await fixture();
  const native = window.forgecut!.invoke;
  let release!: () => void;
  let began!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  let paused = false;
  window.forgecut!.invoke = async <T,>(
    command: string,
    args?: Record<string, unknown>,
    metadata?: CommandMetadata,
  ): Promise<CommandResponse<T>> => {
    const result = await native<T>(command, args, metadata);
    const value = result.ok ? result.value : null;
    if (
      command === "get_editing_context" &&
      !paused &&
      value &&
      typeof value === "object" &&
      "activeSequenceId" in value &&
      value.activeSequenceId === root
    ) {
      paused = true;
      began();
      await held;
    }
    return result;
  };
  try {
    render(<App />);
    await started;
    await act(async () => {
      state.selectSequence(state.sessionId, clip);
    });
    await waitFor(() =>
      expect((screen.getByLabelText("Text") as HTMLInputElement).value).toBe(
        "Clip wording",
      ),
    );
    await act(async () => {
      release();
    });
    expect(
      (screen.getByLabelText("Active sequence") as HTMLSelectElement).value,
    ).toBe(clip);
    expect((screen.getByLabelText("Text") as HTMLInputElement).value).toBe(
      "Clip wording",
    );
    expect(state.getEditingContext().playheadUs).toBe(250000);
  } finally {
    release();
  }
});

it("adds an audio track to an empty sequence without changing another timeline", async () => {
  const { state, App } = await fixture();
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
  fireEvent.click(screen.getByRole("button", { name: "+ Track" }));
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

it("keeps an outgoing view's track command bound to that view during a native switch", async () => {
  const { state, root, clip, App } = await fixture();
  const requests = vi.spyOn(window.forgecut!, "invoke");
  render(<App />);
  await screen.findByLabelText("Text");
  const add = screen.getByRole("button", { name: "+ Track" });
  await act(async () => {
    state.selectSequence(state.sessionId, clip);
    fireEvent.click(add);
  });
  expect(requests).toHaveBeenCalledWith(
    "add_track",
    { kind: "Video" },
    expect.objectContaining({ sequenceId: root }),
  );
  await waitFor(() => expect(state.project.timeline.tracks).toHaveLength(2));
  expect(state.project.timeline.tracks[1].kind).toBe("Video");
  expect(state.project.sequences![0].timeline.tracks).toHaveLength(1);
  expect(state.getEditingContext().activeSequenceId).toBe(clip);
});
