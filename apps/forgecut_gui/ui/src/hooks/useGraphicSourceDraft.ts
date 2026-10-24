import { useEffect, useRef, useState } from "react";
import type { GraphicDraft } from "../../electron/shared/graphic-draft";
import type { GraphicComponent } from "../../electron/shared/graphics";
import type { Result } from "../../electron/shared/result";
import { invoke } from "../lib/bridge";

export function useGraphicSourceDraft(
  sessionId: string,
  itemId: string,
  active: GraphicComponent,
) {
  const [draft, setDraft] = useState<GraphicDraft | null>(null);
  const [status, setStatus] = useState("Loading draft…");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const buffer = useRef<GraphicDraft | null>(null);
  const saved = useRef<GraphicDraft | null>(null);
  const epoch = useRef(0);
  const savedEpoch = useRef(0);
  const pending = useRef<Promise<Result<GraphicDraft>> | null>(null);
  const blocked = useRef(false);
  const alive = useRef(true);
  const loadGeneration = useRef(0);
  const currentActive = useRef(active);
  currentActive.current = active;
  const fail = (failure: unknown): Result<never> => {
    const message =
      failure instanceof Error ? failure.message : String(failure);
    const code =
      failure instanceof Error &&
      "code" in failure &&
      typeof failure.code === "string"
        ? failure.code
        : "IO_ERROR";
    blocked.current = code === "CONFLICT" || code === "PROJECT_CHANGED";
    if (alive.current) {
      setError(message);
      setConflict(blocked.current);
      setStatus("Draft not saved");
    }
    return { ok: false, error: { code, message } };
  };
  const install = (value: GraphicDraft) => {
    buffer.current = structuredClone(value);
    saved.current = structuredClone(value);
    epoch.current += 1;
    savedEpoch.current = epoch.current;
    const mismatch = value.baseVersion !== currentActive.current.version;
    blocked.current = mismatch;
    if (alive.current) {
      setDraft(buffer.current);
      setError(
        mismatch
          ? "The active source changed. Reconcile the draft before continuing."
          : "",
      );
      setConflict(mismatch);
      setStatus(value.revision ? "Draft saved" : "Active source");
    }
  };
  async function reload(): Promise<Result<GraphicDraft>> {
    try {
      const value = await invoke("get_graphic_draft", { itemId });
      install(value);
      return { ok: true, value };
    } catch (failure) {
      return fail(failure);
    }
  }
  async function flush(): Promise<Result<GraphicDraft>> {
    if (!buffer.current || !saved.current)
      return {
        ok: false,
        error: { code: "UNAVAILABLE", message: "The draft has not loaded" },
      };
    if (blocked.current)
      return {
        ok: false,
        error: {
          code: "CONFLICT",
          message: "Reconcile the saved draft before continuing",
        },
      };
    while (savedEpoch.current !== epoch.current) {
      if (pending.current) {
        const previous = await pending.current;
        if (!previous.ok) return previous;
        continue;
      }
      const value = structuredClone(buffer.current);
      const version = epoch.current;
      const work = (async (): Promise<Result<GraphicDraft>> => {
        try {
          const result = await invoke("save_graphic_draft", {
            itemId,
            sessionId,
            expectedDraftRevision: saved.current!.revision,
            baseVersion: value.baseVersion,
            component: value.component,
          });
          saved.current = structuredClone(result);
          savedEpoch.current = version;
          buffer.current = {
            ...buffer.current!,
            revision: result.revision,
            baseVersion: result.baseVersion,
          };
          if (alive.current) {
            setDraft(buffer.current);
            setError("");
            setStatus(
              version === epoch.current ? "Draft saved" : "Saving draft…",
            );
          }
          return { ok: true, value: result };
        } catch (failure) {
          return fail(failure);
        }
      })();
      pending.current = work;
      const result = await work;
      if (pending.current === work) pending.current = null;
      if (!result.ok) return result;
    }
    return { ok: true, value: saved.current };
  }
  const change = (path: string, content: string) => {
    if (!buffer.current) return;
    buffer.current = {
      ...buffer.current,
      component: {
        ...buffer.current.component,
        source: {
          ...buffer.current.component.source,
          files: { ...buffer.current.component.source.files, [path]: content },
        },
      },
    };
    epoch.current += 1;
    setDraft(buffer.current);
    setStatus("Saving draft…");
    void flush();
  };
  const replaceSource = (source: GraphicComponent["source"]) => {
    if (!buffer.current) return;
    buffer.current = {
      ...buffer.current,
      component: { ...buffer.current.component, source },
    };
    epoch.current += 1;
    setDraft(buffer.current);
    setStatus("Saving draft…");
    void flush();
  };
  async function keepEdits(): Promise<Result<GraphicDraft>> {
    if (!buffer.current || !saved.current)
      return {
        ok: false,
        error: { code: "UNAVAILABLE", message: "No source buffer" },
      };
    const local = structuredClone(buffer.current.component.source);
    const original = structuredClone(
      buffer.current.baseVersion === currentActive.current.version
        ? saved.current.component.source
        : currentActive.current.source,
    );
    try {
      const latest = await invoke("get_graphic_draft", { itemId });
      const component = structuredClone(
        latest.baseVersion === currentActive.current.version
          ? latest.component
          : currentActive.current,
      );
      for (const path of new Set([
        ...Object.keys(original.files),
        ...Object.keys(local.files),
      ])) {
        if (local.files[path] === original.files[path]) continue;
        if (local.files[path] === undefined)
          delete component.source.files[path];
        else
          component.source.files = {
            ...component.source.files,
            [path]: local.files[path],
          };
      }
      if (local.entry !== original.entry) component.source.entry = local.entry;
      saved.current = latest;
      buffer.current = {
        ...latest,
        baseVersion: currentActive.current.version,
        component,
      };
      blocked.current = false;
      setConflict(false);
      setError("");
      epoch.current += 1;
      setDraft(buffer.current);
      return flush();
    } catch (failure) {
      return fail(failure);
    }
  }
  async function revert(): Promise<Result<GraphicDraft>> {
    if (pending.current) await pending.current;
    if (!saved.current)
      return {
        ok: false,
        error: { code: "UNAVAILABLE", message: "No saved draft" },
      };
    try {
      const result = await invoke("revert_graphic_draft", {
        itemId,
        sessionId,
        expectedDraftRevision: saved.current.revision,
      });
      install(result);
      return { ok: true, value: result };
    } catch (failure) {
      return fail(failure);
    }
  }
  async function refreshIfClean(): Promise<void> {
    if (pending.current || epoch.current !== savedEpoch.current) return;
    const version = epoch.current;
    try {
      const value = await invoke("get_graphic_draft", { itemId });
      if (alive.current && !pending.current && epoch.current === version)
        install(value);
    } catch (failure) {
      if (alive.current && epoch.current === version) fail(failure);
    }
  }
  useEffect(() => {
    if (!saved.current) return;
    const activeVersion = active.version;
    void invoke("get_graphic_draft", { itemId })
      .then((value) => {
        if (!alive.current || activeVersion !== currentActive.current.version)
          return;
        if (!pending.current && epoch.current === savedEpoch.current)
          install(value);
        else {
          blocked.current = true;
          setConflict(true);
          setError("The active source changed. Your buffer has been retained.");
        }
      })
      .catch(() => {});
  }, [active.version]);
  useEffect(() => {
    alive.current = true;
    loadGeneration.current += 1;
    const generation = loadGeneration.current;
    void invoke("get_graphic_draft", { itemId })
      .then((value) => {
        if (alive.current && loadGeneration.current === generation)
          install(value);
      })
      .catch((failure) => {
        if (alive.current && loadGeneration.current === generation)
          fail(failure);
      });
    const timer = setInterval(() => {
      if (pending.current) return;
      void invoke("get_graphic_draft", { itemId })
        .then((value) => {
          if (
            !alive.current ||
            loadGeneration.current !== generation ||
            pending.current ||
            value.revision === saved.current?.revision
          )
            return;
          if (epoch.current !== savedEpoch.current) {
            blocked.current = true;
            setConflict(true);
            setError("The saved draft changed. Your buffer has been retained.");
          } else install(value);
        })
        .catch(() => {});
    }, 1000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [sessionId, itemId]);
  useEffect(() => {
    let closing = false;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (closing || (!pending.current && epoch.current === savedEpoch.current))
        return;
      event.preventDefault();
      event.returnValue = "Saving source draft";
      void flush().then((result) => {
        if (result.ok) {
          closing = true;
          window.close();
        }
      });
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [sessionId, itemId]);
  return {
    draft,
    dirty: pending.current !== null || epoch.current !== savedEpoch.current,
    status,
    error,
    conflict,
    change,
    replaceSource,
    flush,
    reload,
    keepEdits,
    revert,
    refreshIfClean,
    version: () => epoch.current,
  };
}
