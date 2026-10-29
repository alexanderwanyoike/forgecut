import semver from "semver";
import type { Result } from "../shared/result.js";
import type { UpdateResult, UpdateStatus } from "../shared/updates.js";

export interface UpdateBackend {
  check: () => Promise<Result<string | null>>;
  download: (progress: (percent: number) => void) => Promise<Result<undefined>>;
  install: () => Promise<Result<undefined>>;
}

export function createUpdateService(
  currentVersion: string,
  backend: UpdateBackend | undefined,
  confirm: () => Promise<boolean>,
) {
  let state: UpdateStatus = {
    stage: backend ? "idle" : "manual",
    currentVersion,
  };
  let installing = false;
  const current = (): UpdateResult => ({ ok: true, value: { ...state } });
  const failure = (message: string): UpdateResult => ({
    ok: false,
    error: { code: "UPDATE_FAILED", message },
  });
  return {
    status: () => ({ ...state }),
    async check(): Promise<UpdateResult> {
      if (!backend || !["idle", "available"].includes(state.stage))
        return current();
      const previous = state;
      state = { stage: "checking", currentVersion };
      const result = await backend.check();
      if (!result.ok) {
        state = previous;
        return result;
      }
      state =
        result.value &&
        /^\d+\.\d+\.\d+$/.test(result.value) &&
        semver.valid(result.value) &&
        semver.gt(result.value, currentVersion)
          ? { stage: "available", currentVersion, version: result.value }
          : { stage: "idle", currentVersion };
      return current();
    },
    async download(): Promise<UpdateResult> {
      if (!backend || state.stage !== "available")
        return failure("Check for an available update first.");
      const available = state;
      state = { ...available, stage: "downloading", percent: 0 };
      const result = await backend.download((percent) => {
        if (Number.isFinite(percent))
          state = {
            ...available,
            stage: "downloading",
            percent: Math.round(Math.min(100, Math.max(0, percent))),
          };
      });
      state = result.ok ? { ...available, stage: "ready" } : available;
      return result.ok ? current() : result;
    },
    async install(): Promise<UpdateResult> {
      if (!backend || state.stage !== "ready" || installing)
        return failure("Download the update before restarting.");
      installing = true;
      try {
        if (!(await confirm())) return current();
        const result = await backend.install();
        return result.ok ? current() : result;
      } finally {
        installing = false;
      }
    },
  };
}
