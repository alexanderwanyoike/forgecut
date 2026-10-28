import { EventEmitter } from "node:events";
import { expect, test, vi } from "vitest";
import { createNativeUpdateBackend } from "../native-backend";

test("native client disables unattended installs and reports a verified download", async () => {
  const client = Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    allowDowngrade: true,
    disableDifferentialDownload: false,
    checkForUpdates: vi
      .fn()
      .mockResolvedValue({
        isUpdateAvailable: true,
        updateInfo: { version: "1.1.0" },
      }),
    downloadUpdate: vi.fn().mockImplementation(async () => {
      client.emit("download-progress", { percent: 37 });
      return ["/verified.AppImage"];
    }),
  });
  const install = vi.fn().mockResolvedValue({ ok: true, value: undefined });
  const backend = createNativeUpdateBackend(client, install);
  expect(client).toMatchObject({
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    allowDowngrade: false,
    disableDifferentialDownload: true,
  });
  expect(await backend.check()).toEqual({ ok: true, value: "1.1.0" });
  const progress = vi.fn();
  expect((await backend.download(progress)).ok).toBe(true);
  expect(progress).toHaveBeenCalledWith(37);
  expect(install).not.toHaveBeenCalled();
  expect((await backend.install()).ok).toBe(true);
  expect(install).toHaveBeenCalledWith("/verified.AppImage");
  client.checkForUpdates.mockRejectedValueOnce(new Error("Offline"));
  client.emit("error", new Error("Offline"));
  expect((await backend.check()).ok).toBe(false);
});
