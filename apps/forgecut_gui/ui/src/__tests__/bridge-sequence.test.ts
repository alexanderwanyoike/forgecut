import { createElement } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
  vi.resetModules();
});
async function fixture() {
  const state = new AppState();
  service = new EditingService(state);
  const owner = service;
  await owner.execute("create_sequence", { name: "Clip" });
  window.forgecut = {
    invoke: async <T>(
      command: string,
      args?: Record<string, unknown>,
      metadata?: CommandMetadata,
    ): Promise<CommandResponse<T>> =>
      owner.execute(command, args, metadata) as Promise<CommandResponse<T>>,
    events: {
      listen: <T>(
        event: string,
        callback: (message: { event: string; payload: T }) => void,
      ) =>
        state.subscribe((snapshot) => {
          if (event === "project-changed")
            callback({ event, payload: snapshot as T });
        }),
    },
    dialog: { open: vi.fn(), save: vi.fn() },
    mcp: { status: vi.fn() },
    window: { scaleFactor: vi.fn(), onMoved: vi.fn(), onResized: vi.fn() },
    mediaUrl: (path) => path,
  };
  const bridge = await import("../lib/bridge");
  const unlisten = await bridge.listen("project-changed", () => {});
  await bridge.invoke("get_project_snapshot");
  return { state, bridge, unlisten };
}
it("binds UI edits to the accepted active sequence snapshot", async () => {
  const { state, bridge, unlisten } = await fixture();
  try {
    const clip = state.project.sequences![0].id;
    const text = {
      trackId: "root-titles",
      timelineStartUs: 0,
      durationUs: 1000000,
      text: "Root wording",
      fontSize: 48,
      color: "#ffffff",
      x: 10,
      y: 20,
    };
    await bridge.invoke("add_text_overlay", text);
    await bridge.invoke("select_sequence", {
      sessionId: state.sessionId,
      sequenceId: clip,
    });
    await bridge.invoke("add_text_overlay", {
      ...text,
      trackId: "clip-titles",
      text: "Clip wording",
    });
    expect(state.project.timeline.tracks[0].items[0]).toMatchObject({
      TextOverlay: { text: "Root wording" },
    });
    expect(
      state.project.sequences![0].timeline.tracks[0].items[0],
    ).toMatchObject({ TextOverlay: { text: "Clip wording" } });
  } finally {
    unlisten();
  }
});
it("does not publish a displayed sequence's playhead into a newly selected sequence", async () => {
  const { state, unlisten } = await fixture();
  const { useProject } = await import("../hooks/useProject");
  const { useEditingContext } = await import("../hooks/useEditingContext");
  function Probe() {
    const { snapshot } = useProject();
    useEditingContext(snapshot, null, 1000000);
    return createElement(
      "output",
      { role: "status" },
      snapshot?.activeSequenceId,
    );
  }
  try {
    render(createElement(Probe));
    await waitFor(() =>
      expect(state.getEditingContext().playheadUs).toBe(1000000),
    );
    const root = state.project.default_sequence!.id;
    const clip = state.project.sequences![0].id;
    await act(async () => {
      state.selectSequence(state.sessionId, clip);
    });
    expect(screen.getByRole("status").textContent).toBe(clip);
    expect(state.getEditingContext().playheadUs).toBe(0);
    await act(async () => {
      state.selectSequence(state.sessionId, root);
    });
    expect(state.getEditingContext().playheadUs).toBe(1000000);
  } finally {
    unlisten();
  }
});
function holdSnapshotRead() {
  let release: (() => void) | undefined;
  let began: (() => void) | undefined;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const native = window.forgecut!.invoke;
  window.forgecut!.invoke = async <T>(
    command: string,
    args?: Record<string, unknown>,
    metadata?: CommandMetadata,
  ): Promise<CommandResponse<T>> => {
    const response = await native<T>(command, args, metadata);
    if (command === "get_project_snapshot") {
      began!();
      await paused;
    }
    return response;
  };
  return { started, release: () => release!() };
}

it("keeps the newer sequence target when an older snapshot read arrives late", async () => {
  const { state, bridge, unlisten } = await fixture();
  const { started, release } = holdSnapshotRead();
  try {
    const old = bridge.invoke("get_project_snapshot");
    await started;
    const clip = state.project.sequences![0].id;
    await service!.execute("select_sequence", {
      sessionId: state.sessionId,
      sequenceId: clip,
    });
    release();
    await old;
    await bridge.invoke("add_text_overlay", {
      trackId: "clip-titles",
      timelineStartUs: 0,
      durationUs: 1000000,
      text: "Latest sequence",
      fontSize: 48,
      color: "#ffffff",
      x: 10,
      y: 20,
    });
    expect(state.project.timeline.tracks).toEqual([]);
    expect(
      state.project.sequences![0].timeline.tracks[0].items[0],
    ).toMatchObject({ TextOverlay: { text: "Latest sequence" } });
  } finally {
    release();
    unlisten();
  }
});

it("keeps the newer visible sequence when the initial project read arrives late", async () => {
  const { state, unlisten } = await fixture();
  const { started, release } = holdSnapshotRead();
  const { useProject } = await import("../hooks/useProject");
  function Probe() {
    const { snapshot } = useProject();
    return createElement(
      "output",
      { role: "status" },
      snapshot?.activeSequenceId ?? "Loading",
    );
  }
  try {
    render(createElement(Probe));
    await started;
    const clip = state.project.sequences![0].id;
    await act(async () => {
      await service!.execute("select_sequence", {
        sessionId: state.sessionId,
        sequenceId: clip,
      });
    });
    expect(screen.getByRole("status").textContent).toBe(clip);
    await act(async () => {
      release();
    });
    expect(screen.getByRole("status").textContent).toBe(clip);
  } finally {
    release();
    unlisten();
  }
});
