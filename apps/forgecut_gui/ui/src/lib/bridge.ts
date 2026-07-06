import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { getCurrentWindow as tauriGetCurrentWindow } from "@tauri-apps/api/window";
import { open as tauriOpen, save as tauriSave } from "@tauri-apps/plugin-dialog";

type InvokeArgs = Record<string, unknown>;
type UnlistenFn = () => void;

type ForgeCutElectronApi = {
  invoke: <T>(command: string, args?: InvokeArgs) => Promise<T>;
  dialog: {
    open: <T>(options?: InvokeArgs) => Promise<T>;
    save: <T>(options?: InvokeArgs) => Promise<T>;
  };
  events: {
    listen: <T>(
      event: string,
      callback: (event: { event: string; payload: T }) => void,
    ) => UnlistenFn;
  };
  window: {
    scaleFactor: () => Promise<number>;
    onMoved: (callback: () => void) => Promise<UnlistenFn>;
    onResized: (callback: () => void) => Promise<UnlistenFn>;
  };
};

declare global {
  interface Window {
    forgecut?: ForgeCutElectronApi;
  }
}

const electronApi = () =>
  typeof window === "undefined" ? undefined : window.forgecut;

export function invoke<T = unknown>(
  command: string,
  args?: InvokeArgs,
): Promise<T> {
  const electron = electronApi();
  if (electron) return electron.invoke<T>(command, args);
  return tauriInvoke<T>(command, args);
}

export function open<T = string | string[] | null>(
  options?: InvokeArgs,
): Promise<T> {
  const electron = electronApi();
  if (electron) return electron.dialog.open<T>(options);
  return tauriOpen(options as Parameters<typeof tauriOpen>[0]) as Promise<T>;
}

export function save<T = string | null>(options?: InvokeArgs): Promise<T> {
  const electron = electronApi();
  if (electron) return electron.dialog.save<T>(options);
  return tauriSave(options as Parameters<typeof tauriSave>[0]) as Promise<T>;
}

export function listen<T = unknown>(
  event: string,
  callback: (event: { event: string; payload: T }) => void,
): Promise<UnlistenFn> {
  const electron = electronApi();
  if (electron) return Promise.resolve(electron.events.listen(event, callback));
  return tauriListen<T>(event, callback);
}

export function getCurrentWindow() {
  const electron = electronApi();
  if (electron) return electron.window;
  return tauriGetCurrentWindow();
}
