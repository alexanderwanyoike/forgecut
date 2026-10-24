import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import McpStatus from "../components/McpStatus";
import type { McpStatus as Status } from "../../electron/shared/ipc-contract";

afterEach(() => {
  cleanup();
  delete window.forgecut;
});

it("shows bridge availability and live activity without treating it as creative state", async () => {
  let notify: ((event: { event: string; payload: Status }) => void) | undefined;
  window.forgecut = {
    invoke: vi.fn(),
    dialog: { open: vi.fn(), save: vi.fn() },
    mcp: {
      status: vi.fn().mockResolvedValue({
        available: true,
        statusRevision: 1,
        lastAction: null,
      }),
    },
    events: {
      listen: ((event: string, callback: typeof notify) => {
        notify = callback;
        return () => {
          notify = undefined;
        };
      }) as NonNullable<Window["forgecut"]>["events"]["listen"],
    },
    window: { scaleFactor: vi.fn(), onMoved: vi.fn(), onResized: vi.fn() },
    mediaUrl: (path) => path,
  };
  const view = render(<McpStatus />);
  await screen.findByText("MCP ready");
  await act(async () => {
    notify?.({
      event: "mcp-status",
      payload: {
        available: true,
        statusRevision: 2,
        lastAction: "Trim selected shot",
      },
    });
  });
  expect(screen.getByRole("status").textContent).toContain(
    "Trim selected shot",
  );
  await act(async () => {
    notify?.({
      event: "mcp-status",
      payload: { available: false, statusRevision: 1, lastAction: null },
    });
  });
  expect(screen.getByRole("status").textContent).toContain(
    "Trim selected shot",
  );
  view.unmount();
  expect(notify).toBeUndefined();
});
