import type {
  CommandArgsOf,
  CommandName,
  CommandResultOf,
  EventPayloads,
  CommandResponse,
  CommandMetadata,
} from "../../electron/shared/ipc-contract";

type InvokeArgs = Record<string, unknown>;
type UnlistenFn = () => void;

type ForgeCutElectronApi = {
  invoke: <T>(command: string, args?: InvokeArgs, metadata?: CommandMetadata) => Promise<CommandResponse<T>>;
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

let activeSession: string | undefined;
let activeRevision = -1;

function acceptVersion(sessionId: string, revision: number): void {
  if (revision >= activeRevision) {
    activeSession = sessionId;
    activeRevision = revision;
  }
}

function requireElectronApi(): ForgeCutElectronApi {
  const electron = electronApi();
  if (!electron) {
    throw new Error("ForgeCut Electron bridge is not available");
  }
  return electron;
}

export function invoke<K extends CommandName>(
  command: K,
  ...args: CommandArgsOf<K> extends undefined ? [] : [CommandArgsOf<K>]
): Promise<CommandResultOf<K>> {
  return request(command, args[0] as InvokeArgs | undefined);
}

export function invokeGrouped<K extends CommandName>(group: string, command: K, ...args: CommandArgsOf<K> extends undefined ? [] : [CommandArgsOf<K>]): Promise<CommandResultOf<K>> {
  return request(command, args[0] as InvokeArgs | undefined, group);
}

function request<K extends CommandName>(command: K, args?: InvokeArgs, editGroup?: string): Promise<CommandResultOf<K>> {
  return requireElectronApi().invoke<CommandResultOf<K>>(command, args, {
    sessionId: command === "get_project_snapshot" ? undefined : activeSession, editGroup,
  }).then((response) => {
    if (!response.ok) throw Object.assign(new Error(response.error.message), { code: response.error.code });
    if (response.revision < activeRevision && (command.startsWith("get_") || response.sessionId !== activeSession)) {
      throw Object.assign(new Error("The project changed while this request was running."), { code: "CONFLICT" });
    }
    acceptVersion(response.sessionId, response.revision);
    return response.value;
  }).catch((error) => {
    if (!command.startsWith("get_")) window.dispatchEvent(new CustomEvent("forgecut:command-error", { detail: error.message }));
    throw error;
  });
}

export function open<T = string | string[] | null>(
  options?: InvokeArgs,
): Promise<T> {
  return requireElectronApi().dialog.open<T>(options);
}

export function save<T = string | null>(options?: InvokeArgs): Promise<T> {
  return requireElectronApi().dialog.save<T>(options);
}

export function listen<E extends keyof EventPayloads>(
  event: E,
  callback: (event: { event: string; payload: EventPayloads[E] }) => void,
): Promise<UnlistenFn> {
  return Promise.resolve(requireElectronApi().events.listen<EventPayloads[E]>(event, (message) => {
    if (event === "project-changed") {
      const snapshot = message.payload as EventPayloads["project-changed"];
      if (snapshot.revision < activeRevision) return;
      acceptVersion(snapshot.sessionId, snapshot.revision);
    }
    callback(message);
  }));
}

export function getCurrentWindow() {
  return requireElectronApi().window;
}

export function mediaUrl(path: string): string {
  return requireElectronApi().mediaUrl(path);
}
