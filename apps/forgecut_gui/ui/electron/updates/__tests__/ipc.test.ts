import { expect, test, vi } from "vitest";
import type { BrowserWindow } from "electron";
import type { UpdateResult } from "../../shared/updates";
const handlers = vi.hoisted(
  () =>
    new Map<
      string,
      (
        event: { sender: unknown; senderFrame: unknown },
        ...args: unknown[]
      ) => Promise<UpdateResult>
    >(),
);
vi.mock("electron", () => ({
  app: { isPackaged: false, getVersion: () => "1.0.1" },
  ipcMain: {
    removeHandler: (name: string) => handlers.delete(name),
    handle: (name: string, handler: never) => handlers.set(name, handler),
  },
  shell: { openExternal: vi.fn() },
}));
import { createApplicationUpdates, registerUpdateHandlers } from "../runtime";

test("only the trusted editor main frame can request updates, without arguments", async () => {
  const frame = { url: "forgecut-app://editor/" };
  const contents = { mainFrame: frame };
  registerUpdateHandlers(
    { webContents: contents } as unknown as BrowserWindow,
    createApplicationUpdates(async () => true),
  );
  const status = handlers.get("forgecut:updates:status")!;
  expect((await status({ sender: contents, senderFrame: frame })).ok).toBe(
    true,
  );
  expect((await status({ sender: {}, senderFrame: frame })).ok).toBe(false);
  expect((await status({ sender: contents, senderFrame: {} })).ok).toBe(false);
  expect(
    (
      await status(
        { sender: contents, senderFrame: frame },
        { url: "https://outside.invalid" },
      )
    ).ok,
  ).toBe(false);
  frame.url = "https://outside.invalid/";
  expect((await status({ sender: contents, senderFrame: frame })).ok).toBe(
    false,
  );
});
