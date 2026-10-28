import { expect, test, vi } from "vitest";
import { createUpdateService } from "../service";

test("checks, downloads with progress, and installs only after confirmation", async () => {
  let finish: () => void = () => {
    throw new Error("No download pending");
  };
  const install = vi.fn().mockResolvedValue({ ok: true, value: undefined });
  const confirm = vi.fn().mockResolvedValue(false);
  const updates = createUpdateService(
    "1.0.1",
    {
      check: async () => ({ ok: true, value: "1.1.0" }),
      download: (progress) =>
        new Promise((resolve) => {
          progress(42.4);
          finish = () => resolve({ ok: true, value: undefined });
        }),
      install,
    },
    confirm,
  );
  expect((await updates.install()).ok).toBe(false);
  expect(install).not.toHaveBeenCalled();
  expect(await updates.check()).toMatchObject({
    ok: true,
    value: { stage: "available", version: "1.1.0" },
  });
  const downloading = updates.download();
  expect(updates.status()).toMatchObject({ stage: "downloading", percent: 42 });
  expect((await updates.download()).ok).toBe(false);
  finish();
  expect(await downloading).toMatchObject({
    ok: true,
    value: { stage: "ready" },
  });
  await updates.install();
  expect(install).not.toHaveBeenCalled();
  expect(updates.status().stage).toBe("ready");
  confirm.mockResolvedValue(true);
  await updates.install();
  expect(install).toHaveBeenCalledOnce();
});

test("failed checks and downloads can be retried without losing the offered update", async () => {
  const check = vi
    .fn()
    .mockResolvedValueOnce({
      ok: false,
      error: { code: "OFFLINE", message: "Offline" },
    })
    .mockResolvedValue({ ok: true, value: "1.1.0" });
  const download = vi
    .fn()
    .mockResolvedValueOnce({
      ok: false,
      error: { code: "OFFLINE", message: "Offline" },
    })
    .mockResolvedValue({ ok: true, value: undefined });
  const updates = createUpdateService(
    "1.0.1",
    { check, download, install: vi.fn() },
    async () => true,
  );
  expect((await updates.check()).ok).toBe(false);
  expect(updates.status().stage).toBe("idle");
  await updates.check();
  expect((await updates.download()).ok).toBe(false);
  expect(updates.status().stage).toBe("available");
  await updates.download();
  expect(updates.status().stage).toBe("ready");
  await updates.check();
  expect(check).toHaveBeenCalledTimes(2);
});

test.each(["1.0.1", "0.9.9", "1.1.0-beta.1", "invalid"])(
  "does not offer an unsafe or non-newer version: %s",
  async (version) => {
    const updates = createUpdateService(
      "1.0.1",
      {
        check: async () => ({ ok: true, value: version }),
        download: vi.fn(),
        install: vi.fn(),
      },
      async () => true,
    );
    await updates.check();
    expect(updates.status().stage).toBe("idle");
  },
);
