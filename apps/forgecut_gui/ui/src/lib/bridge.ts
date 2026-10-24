import type {
  CommandArgsOf,
  CommandName,
  CommandResultOf,
  EventPayloads,
  CommandResponse,
  CommandMetadata,
  ProjectSnapshot,
  McpStatus,
} from "../../electron/shared/ipc-contract";

type InvokeArgs = Record<string, unknown>;
type UnlistenFn = () => void;

type ForgeCutElectronApi = {
  invoke: <T>(
    command: string,
    args?: InvokeArgs,
    metadata?: CommandMetadata,
  ) => Promise<CommandResponse<T>>;
  mcp: { status: () => Promise<McpStatus> };
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
let activeSequenceId: string | undefined;
let activeSequenceRevision = -1;
let displayedContext: { sessionId: string; sequenceId: string } | undefined;

export function bindEditorContext(
  sessionId: string,
  sequenceId: string,
): () => void {
  const context = { sessionId, sequenceId };
  displayedContext = context;
  return () => {
    if (displayedContext === context) displayedContext = undefined;
  };
}

function acceptVersion(sessionId: string, revision: number): void {
  if (revision >= activeRevision) {
    activeSession = sessionId;
    activeRevision = revision;
  }
}

function acceptSnapshot(snapshot: ProjectSnapshot): boolean {
  const sequenceRevision = snapshot.sequenceRevision ?? 0;
  if (
    snapshot.revision < activeRevision ||
    (snapshot.sessionId === activeSession &&
      snapshot.revision === activeRevision &&
      sequenceRevision < activeSequenceRevision)
  )
    return false;
  acceptVersion(snapshot.sessionId, snapshot.revision);
  activeSequenceId =
    snapshot.activeSequenceId ?? snapshot.project.default_sequence?.id;
  activeSequenceRevision = sequenceRevision;
  return true;
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

export function invokeGrouped<K extends CommandName>(
  group: string,
  command: K,
  ...args: CommandArgsOf<K> extends undefined ? [] : [CommandArgsOf<K>]
): Promise<CommandResultOf<K>> {
  return request(command, args[0] as InvokeArgs | undefined, group);
}

function request<K extends CommandName>(
  command: K,
  args?: InvokeArgs,
  editGroup?: string,
): Promise<CommandResultOf<K>> {
  const jobControl =
    command === "get_media_job" || command === "cancel_media_job";
  return requireElectronApi()
    .invoke<CommandResultOf<K>>(command, args, {
      sessionId:
        command === "get_project_snapshot" || jobControl
          ? undefined
          : (displayedContext?.sessionId ?? activeSession),
      editGroup,
      sequenceId: jobControl
        ? undefined
        : (displayedContext?.sequenceId ?? activeSequenceId),
    })
    .then((response) => {
      if (!response.ok)
        throw Object.assign(new Error(response.error.message), {
          code: response.error.code,
          ...(response.error.diagnostics
            ? { diagnostics: response.error.diagnostics }
            : {}),
        });
      if (
        !jobControl &&
        command !== "export_project" &&
        response.revision < activeRevision &&
        (command.startsWith("get_") || response.sessionId !== activeSession)
      ) {
        throw Object.assign(
          new Error("The project changed while this request was running."),
          { code: "CONFLICT" },
        );
      }
      if (command === "get_project_snapshot")
        acceptSnapshot(response.value as ProjectSnapshot);
      else acceptVersion(response.sessionId, response.revision);
      return response.value;
    })
    .catch((error: unknown) => {
      if (!command.startsWith("get_") && command !== "set_editing_context")
        window.dispatchEvent(
          new CustomEvent("forgecut:command-error", {
            detail: error instanceof Error ? error.message : String(error),
          }),
        );
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
  return Promise.resolve(
    requireElectronApi().events.listen<EventPayloads[E]>(event, (message) => {
      if (event === "project-changed") {
        const snapshot = message.payload as EventPayloads["project-changed"];
        if (!acceptSnapshot(snapshot)) return;
      }
      callback(message);
    }),
  );
}

export function getCurrentWindow() {
  return requireElectronApi().window;
}

export function mediaUrl(path: string): string {
  return requireElectronApi().mediaUrl(path);
}

export function getMcpStatus(): Promise<McpStatus> {
  return requireElectronApi().mcp.status();
}
