import { useEffect, useState } from "react";
import type { McpStatus as Status } from "../../electron/shared/ipc-contract";
import { getMcpStatus, listen } from "../lib/bridge";

export default function McpStatus() {
  const [status, setStatus] = useState<Status>({
    available: false,
    statusRevision: -1,
    lastAction: null,
  });
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const accept = (next: Status) => {
      if (!cancelled)
        setStatus((current) =>
          next.statusRevision >= current.statusRevision ? next : current,
        );
    };
    void (async () => {
      unsubscribe = await listen("mcp-status", ({ payload }) =>
        accept(payload),
      );
      if (cancelled) {
        unsubscribe();
        return;
      }
      accept(await getMcpStatus());
    })().catch(() => {});
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);
  let label = "MCP unavailable";
  if (status.available)
    label = status.lastAction ? `MCP: ${status.lastAction}` : "MCP ready";
  return (
    <span
      className="mcp-status"
      role="status"
      title={label}
      data-available={status.available}
    >
      {label}
    </span>
  );
}
