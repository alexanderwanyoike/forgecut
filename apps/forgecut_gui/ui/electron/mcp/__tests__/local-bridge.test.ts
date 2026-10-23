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
