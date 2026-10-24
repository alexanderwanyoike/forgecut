import { useEffect, useState } from "react";
import { invoke, listen } from "../lib/bridge";
import type { ProjectSnapshot } from "../../electron/shared/ipc-contract";

export function useProject() {
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const accept = (next: ProjectSnapshot) => {
      if (!cancelled) setSnapshot((current) => !current || next.revision >= current.revision ? next : current);
    };
    (async () => {
      unsubscribe = await listen("project-changed", ({ payload }) => accept(payload));
      if (cancelled) { unsubscribe(); return; }
      accept(await invoke("get_project_snapshot"));
    })().catch((reason) => { if (!cancelled) setError(String(reason)); });
    const onError = (event: Event) => setError((event as CustomEvent<string>).detail);
    window.addEventListener("forgecut:command-error", onError);
    return () => {
      cancelled = true;
      unsubscribe?.();
      window.removeEventListener("forgecut:command-error", onError);
    };
  }, []);
  return { snapshot, error, setError };
}
