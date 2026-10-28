/** @vitest-environment node */
import { expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({
  windows: [] as {
    maximize: ReturnType<typeof vi.fn>;
    loadURL: ReturnType<typeof vi.fn>;
  }[],
  events: new Map<string, () => void>(),
}));

vi.mock("electron", () => ({
  app: {
    on: vi.fn((event: string, listener: () => void) => {
      desktop.events.set(event, listener);
    }),
    whenReady: () => Promise.resolve(),
    commandLine: { appendSwitch: vi.fn() },
    quit: vi.fn(),
  },
  BrowserWindow: Object.assign(
    vi.fn(function createWindow() {
      const window = {
        maximize: vi.fn(),
        loadURL: vi.fn().mockResolvedValue(undefined),
      };
      desktop.windows.push(window);
      return window;
    }),
    { getAllWindows: () => [] },
  ),
  dialog: {},
  ipcMain: { handle: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
}));
vi.mock("../backend/state.js", () => ({
  AppState: vi.fn(function createState() {
    return { subscribe: vi.fn() };
  }),
}));
vi.mock("../backend/editing-service.js", () => ({
  EditingService: vi.fn(function createService() {
    return {};
  }),
}));
vi.mock("../mcp/local-bridge.js", () => ({
  startLocalBridge: vi.fn().mockResolvedValue({ close: vi.fn() }),
}));

it("opens the editor maximized on startup and when reopening its last window", async () => {
  await import("../main.js");
  await vi.waitFor(() => expect(desktop.windows).toHaveLength(1));
  const first = desktop.windows[0];
  expect(first.maximize).toHaveBeenCalledOnce();
  expect(first.maximize.mock.invocationCallOrder[0]).toBeLessThan(
    first.loadURL.mock.invocationCallOrder[0],
  );

  desktop.events.get("activate")!();
  expect(desktop.windows).toHaveLength(2);
  expect(desktop.windows[1].maximize).toHaveBeenCalledOnce();
});
