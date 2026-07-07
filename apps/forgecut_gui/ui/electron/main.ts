import { app, BrowserWindow, dialog, ipcMain, protocol } from "electron";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { AppState } from "./backend/state.js";
import { dispatchCommand } from "./backend/ipc.js";
import { mediaResponseInit } from "./backend/media-protocol.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const state = new AppState();

protocol.registerSchemesAsPrivileged([
  {
    scheme: "forgecut-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

// Dev-only: never open a debug port in packaged builds
if (process.env.ELECTRON_REMOTE_DEBUGGING_PORT) {
  app.commandLine.appendSwitch(
    "remote-debugging-port",
    process.env.ELECTRON_REMOTE_DEBUGGING_PORT,
  );
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "ForgeCut",
    autoHideMenuBar: true,
    icon: join(__dirname, "../assets/icon.png"),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void win.loadURL(rendererUrl);
  } else {
    void win.loadFile(join(__dirname, "../../dist/index.html"));
  }
}

ipcMain.handle("forgecut:invoke", (event, command: string, args) => {
  return dispatchCommand(event, state, command, args);
});

ipcMain.handle("forgecut:dialog:open", async (_event, options = {}) => {
  const result = await dialog.showOpenDialog(options);
  if (result.canceled) return null;
  return options?.multiple ? result.filePaths : result.filePaths[0] ?? null;
});

ipcMain.handle("forgecut:dialog:save", async (_event, options = {}) => {
  const result = await dialog.showSaveDialog(options);
  return result.canceled ? null : result.filePath ?? null;
});

app.whenReady().then(() => {
  protocol.handle("forgecut-media", async (request) => {
    const url = new URL(request.url);
    const path = url.searchParams.get("path");
    if (!path) return new Response("Missing media path", { status: 400 });
    if (!state.project.assets.some((asset) => asset.path === path)) {
      return new Response("Media path is not part of the current project", { status: 403 });
    }

    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      return new Response("Media not found", { status: 404 });
    }

    // Serve Range requests ourselves: <video> seeking needs 206 responses,
    // which net.fetch(file://) does not produce.
    const init = mediaResponseInit(request.headers.get("range"), size, path);
    if (init.status === 416) {
      return new Response(null, init);
    }
    const stream = createReadStream(
      path,
      init.range ? { start: init.range.start, end: init.range.end } : {},
    );
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, init);
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
