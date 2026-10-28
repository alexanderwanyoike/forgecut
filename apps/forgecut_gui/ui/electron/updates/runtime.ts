import { app, ipcMain, shell } from "electron";
import type { BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import type { UpdateResult } from "../shared/updates.js";
import { createNativeUpdateBackend } from "./native-backend.js";
import { createUpdateService } from "./service.js";
import { replaceAppImage } from "./replace-appimage.js";

export const RELEASES_URL =
  "https://github.com/alexanderwanyoike/forgecut/releases/latest";
export function automaticUpdatesSupported(
  packaged: boolean,
  platform: string,
  arch: string,
  appImage?: string,
): boolean {
  return (
    packaged && arch === "x64" && platform === "linux" && Boolean(appImage)
  );
}

export function createApplicationUpdates(confirm: () => Promise<boolean>) {
  const image = process.env.APPIMAGE;
  const supported = automaticUpdatesSupported(
    app.isPackaged,
    process.platform,
    process.arch,
    image,
  );
  let backend;
  if (supported && image) {
    const feed = {
      provider: "github" as const,
      owner: "alexanderwanyoike",
      repo: "forgecut",
    };
    const client = new electronUpdater.AppImageUpdater(feed);
    client.logger = null;
    backend = createNativeUpdateBackend(client, async (file) => {
      const replaced = await replaceAppImage(image, file);
      if (!replaced.ok) return replaced;
      app.relaunch({ execPath: image });
      app.quit();
      return { ok: true, value: undefined };
    });
  }
  return createUpdateService(app.getVersion(), backend, confirm);
}

export function registerUpdateHandlers(
  window: BrowserWindow,
  updates: ReturnType<typeof createApplicationUpdates>,
) {
  const operations = {
    status: (): UpdateResult => ({ ok: true, value: updates.status() }),
    check: () => updates.check(),
    download: () => updates.download(),
    install: () => updates.install(),
    releases: async (): Promise<UpdateResult> => {
      await shell.openExternal(RELEASES_URL);
      return { ok: true, value: updates.status() };
    },
  };
  for (const [name, operation] of Object.entries(operations)) {
    const channel = `forgecut:updates:${name}`;
    ipcMain.removeHandler(channel);
    ipcMain.handle(
      channel,
      async (event, ...args: unknown[]): Promise<UpdateResult> => {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          event.senderFrame?.url !==
            new URL(
              process.env.ELECTRON_RENDERER_URL ?? "forgecut-app://editor/",
            ).href ||
          args.length > 0
        )
          return {
            ok: false,
            error: {
              code: "UPDATE_FORBIDDEN",
              message: "This update request is not allowed from this window.",
            },
          };
        try {
          return await operation();
        } catch {
          return {
            ok: false,
            error: {
              code: "UPDATE_FAILED",
              message:
                "The update could not finish. Please retry or download an installer.",
            },
          };
        }
      },
    );
  }
}
