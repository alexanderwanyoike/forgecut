/** @vitest-environment node */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { AppState } from "../../backend/state";
import { EditingService } from "../../backend/editing-service";
import { startLocalBridge } from "../local-bridge";
import { callBridge, listSessions } from "../sessions";

it("discovers an explicit local session and authenticates reads of the real owner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-bridge-"));
  const state = new AppState();
  const bridge = await startLocalBridge(new EditingService(state), directory);
  try {
    const sessions = await listSessions(directory);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(bridge.session.id);
    expect(
      await callBridge(
        { ...bridge.session, secret: "wrong" },
        { action: "summary" },
      ),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
    expect(
      await callBridge(bridge.session, { action: "summary" }),
    ).toMatchObject({
      ok: true,
      value: {
        projectId: state.project.id,
        name: "Untitled",
        revision: state.revision,
        sessionId: state.sessionId,
      },
    });
  } finally {
    await bridge.close();
    expect(await listSessions(directory)).toEqual([]);
    await rm(directory, { recursive: true, force: true });
  }
});

it("commits guarded batches to the UI owner and reports created item IDs on retries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-edits-"));
  const state = new AppState();
  const bridge = await startLocalBridge(new EditingService(state), directory);
  try {
    const request = {
      sessionId: state.sessionId,
      expectedRevision: state.revision,
      requestId: "create-title",
      operations: [
        {
          command: "add_text_overlay",
          args: {
            trackId: "titles",
            timelineStartUs: 0,
            durationUs: 1000000,
            text: "First",
            fontSize: 48,
            color: "#ffffff",
            x: 0,
            y: 0,
          },
        },
      ],
    };
    const first = await callBridge(bridge.session, {
      action: "apply",
      label: "Add title",
      request,
    });
    const item = state.project.timeline.tracks[0]?.items[0];
    expect(item && "TextOverlay" in item).toBe(true);
    if (!item || !("TextOverlay" in item))
      throw new Error("Title was not committed");
    expect(first).toMatchObject({
      ok: true,
      value: { revision: 1, changedItemIds: [item.TextOverlay.id] },
    });
    await new EditingService(state).execute("update_project", {
      name: "Manual edit",
    });
    expect(
      await callBridge(bridge.session, {
        action: "apply",
        label: "Add title",
        request,
      }),
    ).toEqual(first);
    expect(
      await callBridge(bridge.session, {
        action: "apply",
        label: "Stale edit",
        request: { ...request, requestId: "different" },
      }),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    const timeline = await callBridge(bridge.session, {
      action: "timeline",
      offset: 0,
      limit: 1,
      startUs: 0,
      endUs: 1000000,
    });
    expect(timeline).toMatchObject({
      ok: true,
      value: { revision: 2, total: 1, items: [item] },
    });
    state.undo();
    state.undo();
    expect(state.project.timeline.tracks).toEqual([]);
  } finally {
    await bridge.close();
    await rm(directory, { recursive: true, force: true });
  }
});
