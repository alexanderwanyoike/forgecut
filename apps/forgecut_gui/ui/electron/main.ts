import { app, BrowserWindow, dialog, ipcMain, protocol } from "electron";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import type { McpStatus, EventSink } from "./shared/ipc-contract.js";
import { startLocalBridge } from "./mcp/local-bridge.js";
import { AppState } from "./backend/state.js";
import { EditingService } from "./backend/editing-service.js";
import { graphicResourceResponse } from "./backend/graphic-resource-response.js";
import { mediaResponseInit } from "./backend/media-protocol.js";
import { appAssetResponse } from "./backend/app-assets.js";

import {
  createApplicationUpdates,
  registerUpdateHandlers,
} from "./updates/runtime.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const state = new AppState();
const editing = new EditingService(state);
let localBridge: Awaited<ReturnType<typeof startLocalBridge>> | undefined;
let updates: ReturnType<typeof createApplicationUpdates> | undefined;
let quitting = false;
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void Promise.allSettled([
    editing.batches.close(),
    editing.jobs.close(),
    editing.closePreviews(),
    localBridge?.close(),
  ]).then((results) => {
    for (const result of results) {
      if (result.status === "rejected") console.error(result.reason);
    }
    app.quit();
  });
});
const broadcast: EventSink = (event, payload) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed())
      win.webContents.send(`forgecut:event:${event}`, payload);
  }
};
state.subscribe((snapshot) => broadcast("project-changed", snapshot));
let mcpStatus: McpStatus = {
  available: false,
  statusRevision: 0,
  lastAction: null,
};
ipcMain.handle("forgecut:mcp-status", (): McpStatus => mcpStatus);

protocol.registerSchemesAsPrivileged([
  {
    scheme: "forgecut-app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  {
    scheme: "forgecut-resource",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
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

  win.maximize();
  if (updates) registerUpdateHandlers(win, updates);

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void win.loadURL(rendererUrl);
  } else {
    void win.loadURL("forgecut-app://editor/");
  }
}

ipcMain.handle(
  "forgecut:invoke",
  (_event, command: string, args: unknown, metadata: unknown) =>
    editing.execute(command, args, metadata),
);

ipcMain.handle(
  "forgecut:dialog:open",
  async (
    _event,
    options: Electron.OpenDialogOptions & { multiple?: boolean } = {},
  ) => {
    const result = await dialog.showOpenDialog(options);
    if (result.canceled) return null;
    return options?.multiple ? result.filePaths : (result.filePaths[0] ?? null);
  },
);

ipcMain.handle(
  "forgecut:dialog:save",
  async (_event, options: Electron.SaveDialogOptions = {}) => {
    const result = await dialog.showSaveDialog(options);
    return result.canceled ? null : (result.filePath ?? null);
  },
);

void app.whenReady().then(async () => {
  updates = createApplicationUpdates(async () => {
    const { revision } = state;
    const session = state.sessionId;
    const choice = await dialog.showMessageBox({
      type: "question",
      message: "Restart ForgeCut to install the update?",
      detail:
        "Your project must be saved first. Playback will stop and any active imports or exports will be cancelled.",
      buttons: ["Keep working", "Restart to update"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return (
      choice.response === 1 &&
      state.revision === revision &&
      state.sessionId === session
    );
  });
  if (app.isPackaged) {
    const timer = setTimeout(() => {
      void updates?.check();
    }, 30_000);
    timer.unref();
  }
  protocol.handle("forgecut-app", (request) =>
    appAssetResponse(join(__dirname, "../../dist"), request.url),
  );
  try {
    localBridge = await startLocalBridge(editing, undefined, (label) => {
      mcpStatus = {
        available: true,
        statusRevision: mcpStatus.statusRevision + 1,
        lastAction: label,
      };
      broadcast("mcp-status", mcpStatus);
    });
    mcpStatus = {
      available: true,
      statusRevision: mcpStatus.statusRevision + 1,
      lastAction: null,
    };
  } catch (error) {
    console.warn("MCP connection unavailable:", error);
  }
  protocol.handle("forgecut-resource", (request) =>
    graphicResourceResponse(state.project.resources ?? [], request.url),
  );
  protocol.handle("forgecut-media", async (request) => {
    const url = new URL(request.url);
    const path = url.searchParams.get("path");
    if (!path) return new Response("Missing media path", { status: 400 });
    if (
      !state.project.assets.some((asset) => asset.path === path) &&
      !editing.renders.owns(path) &&
      !editing.proxies.owns(path)
    ) {
      return new Response("Media path is not part of the current project", {
        status: 403,
      });
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
    return new Response(
      Readable.toWeb(stream) as unknown as ReadableStream,
      init,
    );
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
