import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import ApplicationFooter from "../components/ApplicationFooter";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "forgecut");
});
test("footer checks, downloads and protects work before requesting a restart", async () => {
  const status = { stage: "idle", currentVersion: "1.0.1" };
  const updates = {
    status: vi.fn().mockResolvedValue({ ok: true, value: status }),
    check: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        value: { ...status, stage: "available", version: "1.1.0" },
      }),
    download: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        value: { ...status, stage: "ready", version: "1.1.0" },
      }),
    install: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        value: { ...status, stage: "ready", version: "1.1.0" },
      }),
    releases: vi.fn(),
  };
  Object.defineProperty(window, "forgecut", {
    configurable: true,
    value: { updates },
  });
  const beforeInstall = vi.fn().mockResolvedValue(false);
  render(<ApplicationFooter beforeInstall={beforeInstall} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Check for updates" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Download v1.1.0" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Restart to update" }),
  );
  await waitFor(() => expect(beforeInstall).toHaveBeenCalledOnce());
  expect(updates.install).not.toHaveBeenCalled();
  beforeInstall.mockResolvedValue(true);
  fireEvent.click(
    await screen.findByRole("button", { name: "Restart to update" }),
  );
  await waitFor(() => expect(updates.install).toHaveBeenCalledOnce());
});
