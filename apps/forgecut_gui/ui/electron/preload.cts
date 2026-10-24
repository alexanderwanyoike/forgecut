import { contextBridge, ipcRenderer } from "electron";
import type { McpStatus } from "./shared/ipc-contract.js";

contextBridge.exposeInMainWorld("forgecut", {
  invoke: (
    command: string,
    args?: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ) => ipcRenderer.invoke("forgecut:invoke", command, args, metadata),
  mcp: {
    status: () =>
      ipcRenderer.invoke("forgecut:mcp-status") as Promise<McpStatus>,
  },
  dialog: {
    open: (options?: Record<string, unknown>) =>
      ipcRenderer.invoke("forgecut:dialog:open", options),
    save: (options?: Record<string, unknown>) =>
      ipcRenderer.invoke("forgecut:dialog:save", options),
  },
  events: {
    listen: (
      event: string,
      callback: (payload: { event: string; payload: unknown }) => void,
    ) => {
      const channel = `forgecut:event:${event}`;
      const listener = (
        _ipcEvent: Electron.IpcRendererEvent,
        payload: unknown,
      ) => {
        callback({ event, payload });
      };
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  },
  window: {
    scaleFactor: () => Promise.resolve(window.devicePixelRatio || 1),
    onMoved: (callback: () => void) => {
      window.addEventListener("resize", callback);
      return Promise.resolve(() =>
        window.removeEventListener("resize", callback),
      );
    },
    onResized: (callback: () => void) => {
      window.addEventListener("resize", callback);
      return Promise.resolve(() =>
        window.removeEventListener("resize", callback),
      );
    },
  },
  mediaUrl: (path: string) =>
    `forgecut-media://local/?path=${encodeURIComponent(path)}`,
});
