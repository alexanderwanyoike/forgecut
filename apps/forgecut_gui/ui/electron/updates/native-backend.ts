import type { AppUpdater } from "electron-updater";
import type { Result } from "../shared/result.js";
import type { UpdateBackend } from "./service.js";

type Client = Pick<
  AppUpdater,
  | "autoDownload"
  | "autoInstallOnAppQuit"
  | "allowPrerelease"
  | "allowDowngrade"
  | "disableDifferentialDownload"
  | "checkForUpdates"
  | "downloadUpdate"
  | "on"
>;
export function createNativeUpdateBackend(
  client: Client,
  install: (file: string) => Promise<Result<undefined>>,
): UpdateBackend {
  Object.assign(client, {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    allowDowngrade: false,
    disableDifferentialDownload: true,
  });
  let file: string | undefined;
  let report: ((percent: number) => void) | undefined;
  client.on("download-progress", (progress) => report?.(progress.percent));
  // The promise reports operation failures; an unhandled EventEmitter error would terminate the editor.
  client.on("error", () => {});
  const failure = (message: string): Result<never> => ({
    ok: false,
    error: { code: "UPDATE_FAILED", message },
  });
  return {
    async check() {
      try {
        const result = await client.checkForUpdates();
        return {
          ok: true,
          value: result?.isUpdateAvailable ? result.updateInfo.version : null,
        };
      } catch {
        return failure(
          "Could not check for updates. Check your connection and retry.",
        );
      }
    },
    async download(progress) {
      report = progress;
      try {
        const files = await client.downloadUpdate();
        [file] = files;
        return file
          ? { ok: true, value: undefined }
          : failure("No verified installer was downloaded.");
      } catch {
        return failure(
          "Could not download the update. Check your connection and retry.",
        );
      } finally {
        report = undefined;
      }
    },
    install: () =>
      file
        ? install(file)
        : Promise.resolve(failure("Download the update before installing.")),
  };
}
