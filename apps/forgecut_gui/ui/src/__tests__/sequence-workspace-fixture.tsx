import { cleanup } from "@testing-library/react";
import { expect, vi } from "vitest";
import { AppState } from "../../electron/backend/state";
import { EditingService } from "../../electron/backend/editing-service";
import type {
  CommandMetadata,
  CommandResponse,
} from "../../electron/shared/ipc-contract";

let service: EditingService | undefined;
export async function cleanupSequenceWorkspace() {
  cleanup();
  delete window.forgecut;
  if (service) {
    await service.jobs.close();
    await service.closeGraphicsPreview();
  }
  vi.restoreAllMocks();
  vi.resetModules();
}

export async function sequenceWorkspaceFixture() {
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
  const rootTitle = state.project.timeline.tracks[0].items[0];
  const clipTitle = state.project.sequences![0].timeline.tracks[0].items[0];
  if (
    !("TextOverlay" in rootTitle) ||
    !rootTitle.TextOverlay ||
    !("TextOverlay" in clipTitle) ||
    !clipTitle.TextOverlay
  )
    throw new Error("Missing fixture titles");
  const rootItem = rootTitle.TextOverlay.id;
  const clipItem = clipTitle.TextOverlay.id;
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
  return { state, root, clip, App, service: owner };
}
