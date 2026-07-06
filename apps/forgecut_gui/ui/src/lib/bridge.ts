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
  mediaUrl: (path: string) => string;
};

declare global {
  interface Window {
    forgecut?: ForgeCutElectronApi;
  }
}

const electronApi = () =>
  typeof window === "undefined" ? undefined : window.forgecut;

function requireElectronApi(): ForgeCutElectronApi {
  const electron = electronApi();
  if (!electron) {
    throw new Error("ForgeCut Electron bridge is not available");
  }
  return electron;
}

export function invoke<T = unknown>(
  command: string,
  args?: InvokeArgs,
): Promise<T> {
  return requireElectronApi().invoke<T>(command, args);
}

export function open<T = string | string[] | null>(
  options?: InvokeArgs,
): Promise<T> {
  return requireElectronApi().dialog.open<T>(options);
}

export function save<T = string | null>(options?: InvokeArgs): Promise<T> {
  return requireElectronApi().dialog.save<T>(options);
}

export function listen<T = unknown>(
  event: string,
  callback: (event: { event: string; payload: T }) => void,
): Promise<UnlistenFn> {
  return Promise.resolve(requireElectronApi().events.listen(event, callback));
}

export function getCurrentWindow() {
  return requireElectronApi().window;
}

export function mediaUrl(path: string): string {
  return requireElectronApi().mediaUrl(path);
}
