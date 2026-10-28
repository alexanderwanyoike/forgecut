import { useCallback, useEffect, useRef, useState } from "react";

export type ResultRequest<T> = {
  /** What the result belongs to, such as an item or asset. */
  slot: string;
  /** Identifies the content the result is for; a new key requests again. */
  key: string;
  load: () => Promise<T>;
};

/** A settled result for a slot's current key; undefined while one is pending. */
export type RequestedResult<T> = { value: T } | { failed: true };

const RETRYABLE = new Set(["CONFLICT", "CANCELLED", "PROJECT_CHANGED"]);

// A conflicting edit may land before its snapshot reaches the editor, so retry after a pause.
const RETRY_MS = 250;

/** Loads each slot's result once per key, keeping the latest one per slot. */
export function useRequestedResults<T>(
  requests: ResultRequest<T>[],
): (slot: string, key: string) => RequestedResult<T> | undefined {
  const [results, setResults] = useState<
    ReadonlyMap<string, { key: string; result: RequestedResult<T> }>
  >(() => new Map());
  const pending = useRef(new Set<string>());
  const latest = useRef(requests);
  latest.current = requests;
  const [attempt, retry] = useState(0);
  const signature = requests
    .map((request) => `${request.slot}\n${request.key}`)
    .join("\n\n");
  useEffect(() => {
    for (const { slot, key, load } of latest.current) {
      const id = `${slot}\n${key}`;
      if (results.get(slot)?.key === key || pending.current.has(id)) continue;
      pending.current.add(id);
      const settle = (result: RequestedResult<T>) =>
        setResults((current) => new Map(current).set(slot, { key, result }));
      load()
        .then((value) => settle({ value }))
        .catch((failure: unknown) => {
          const code = (failure as { code?: unknown } | null)?.code;
          if (typeof code === "string" && RETRYABLE.has(code))
            setTimeout(() => retry((value) => value + 1), RETRY_MS);
          else settle({ failed: true });
        })
        .finally(() => pending.current.delete(id));
    }
  }, [signature, results, attempt]);
  return useCallback(
    (slot, key) => {
      const entry = results.get(slot);
      return entry?.key === key ? entry.result : undefined;
    },
    [results],
  );
}
