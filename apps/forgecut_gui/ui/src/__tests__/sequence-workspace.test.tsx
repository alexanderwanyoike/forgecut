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
import type {
  CommandMetadata,
  CommandResponse,
} from "../../electron/shared/ipc-contract";
afterEach(cleanupSequenceWorkspace);

it("invalidates a pending context reply across a batched same-sequence round trip", async () => {
  const { state, root, clip, App } = await sequenceWorkspaceFixture();
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
    if (command === "get_editing_context" && !paused) {
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
      const context = state.getEditingContext();
      state.setEditingContext({
        ...context,
        sequenceId: root,
        playheadUs: 2000000,
      });
      state.selectSequence(state.sessionId, clip);
      state.selectSequence(state.sessionId, root);
      release();
    });
    await screen.findByLabelText("Text");
    await waitFor(() =>
      expect(state.getEditingContext().playheadUs).toBe(2000000),
    );
    expect(screen.getByText("00:00:02.000")).toBeTruthy();
  } finally {
    release();
  }
});

it("switches every editing surface and restores each sequence context without creative edits", async () => {
  const { state, root, clip, App } = await sequenceWorkspaceFixture();
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
      state.project.sequences![0].timeline.tracks[0].items[0],
    ).toMatchObject({ TextOverlay: { text: "Manual clip wording" } }),
  );
  expect(state.project.timeline.tracks[0].items[0]).toMatchObject({
    TextOverlay: { text: "Root wording" },
  });
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

it("ignores a delayed context reply after the visible sequence has changed", async () => {
  const { state, root, clip, App } = await sequenceWorkspaceFixture();
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

it("keeps an outgoing view's track command bound to that view during a native switch", async () => {
  const { state, root, clip, App } = await sequenceWorkspaceFixture();
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

it("keeps the export target captured before the destination dialog opens", async () => {
  const {
    state,
    root,
    clip,
    App,
    service: owner,
  } = await sequenceWorkspaceFixture();
  const requests = vi.spyOn(window.forgecut!, "invoke");
  let choose!: (path: string) => void;
  let opened!: () => void;
  const destination = new Promise<string>((resolve) => {
    choose = resolve;
  });
  const dialogOpened = new Promise<void>((resolve) => {
    opened = resolve;
  });
  window.forgecut!.dialog.save = vi.fn().mockImplementation(() => {
    opened();
    return destination;
  });
  owner.jobs.start(
    {
      sessionId: state.sessionId,
      projectRevision: state.revision,
      requestId: "hold-ui-export",
      kind: "frame",
      label: "Held",
      input: null,
    },
    async (signal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      return { ok: true, value: null };
    },
  );
  try {
    render(<App />);
    await screen.findByLabelText("Text");
    fireEvent.click(screen.getByText("Export"));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await dialogOpened;
    await act(async () => {
      state.selectSequence(state.sessionId, clip);
    });
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Active sequence") as HTMLSelectElement).value,
      ).toBe(clip),
    );
    await act(async () => {
      choose("/tmp/forgecut-ui-export.mp4");
    });
    await waitFor(() =>
      expect(requests).toHaveBeenCalledWith(
        "export_project",
        expect.objectContaining({ sequenceId: root }),
        expect.objectContaining({
          sessionId: state.sessionId,
          sequenceId: root,
        }),
      ),
    );
    expect(state.getEditingContext().activeSequenceId).toBe(clip);
  } finally {
    choose("/tmp/forgecut-ui-export.mp4");
  }
});
