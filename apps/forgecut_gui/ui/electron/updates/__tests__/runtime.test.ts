import { expect, test, vi } from "vitest";
const mocked = vi.hoisted(() => ({ packaged: false, client: vi.fn() }));
vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return mocked.packaged;
    },
    getVersion: () => "1.0.1",
  },
}));
vi.mock("electron-updater", () => ({
  default: { AppImageUpdater: mocked.client, NsisUpdater: mocked.client },
}));
import {
  createApplicationUpdates,
  automaticUpdatesSupported,
} from "../runtime";

test("development builds do not construct an updater or contact the feed", async () => {
  const updates = createApplicationUpdates(async () => true);
  expect(updates.status()).toMatchObject({
    stage: "manual",
    currentVersion: "1.0.1",
  });
  await updates.check();
  expect(mocked.client).not.toHaveBeenCalled();
});
test("only installed x64 AppImages and Windows use in-app installation", () => {
  expect(automaticUpdatesSupported(true, "linux", "x64", "/app.AppImage")).toBe(
    true,
  );
  expect(automaticUpdatesSupported(true, "win32", "x64")).toBe(true);
  expect(
    automaticUpdatesSupported(false, "linux", "x64", "/app.AppImage"),
  ).toBe(false);
  expect(automaticUpdatesSupported(true, "linux", "x64")).toBe(false);
  expect(automaticUpdatesSupported(true, "darwin", "arm64")).toBe(false);
});
