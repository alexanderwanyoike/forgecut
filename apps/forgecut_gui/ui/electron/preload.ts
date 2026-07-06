import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("forgecut", {
  invoke: (command: string, args?: Record<string, unknown>) =>
    ipcRenderer.invoke("forgecut:invoke", command, args),
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
      const listener = (_ipcEvent: Electron.IpcRendererEvent, payload: unknown) => {
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
      return Promise.resolve(() => window.removeEventListener("resize", callback));
    },
    onResized: (callback: () => void) => {
      window.addEventListener("resize", callback);
      return Promise.resolve(() => window.removeEventListener("resize", callback));
    },
  },
});
