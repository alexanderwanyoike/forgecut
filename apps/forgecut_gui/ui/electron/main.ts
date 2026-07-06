import { app, BrowserWindow, dialog, ipcMain, net, protocol } from "electron";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { AppState } from "./backend/state.js";
import { dispatchCommand } from "./backend/ipc.js";

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

app.commandLine.appendSwitch("remote-debugging-port", "9222");

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "ForgeCut",
    icon: join(__dirname, "../assets/icon.png"),
    webPreferences: {
      preload: join(__dirname, "preload.js"),
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
  protocol.handle("forgecut-media", (request) => {
    const url = new URL(request.url);
    const path = url.searchParams.get("path");
    if (!path) return new Response("Missing media path", { status: 400 });
    if (!state.project.assets.some((asset) => asset.path === path)) {
      return new Response("Media path is not part of the current project", { status: 403 });
    }
    return net.fetch(pathToFileURL(path).toString(), {
      headers: request.headers,
    });
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
