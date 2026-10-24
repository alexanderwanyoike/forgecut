/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { JobQueue } from "../job-queue";

it("keeps heavy work serial and makes queued work observable immediately", async () => {
  const jobs = new JobQueue();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = jobs.start(
    {
      sessionId: "session",
      projectRevision: 0,
      requestId: "first",
      kind: "import",
      label: "Import",
      input: {},
    },
    async () => {
      await held;
      return { ok: true, value: "first" };
    },
  );
  const second = jobs.start(
    {
      sessionId: "session",
      projectRevision: 0,
      requestId: "second",
      kind: "frame",
      label: "Source frame",
      input: {},
    },
    () => Promise.resolve({ ok: true, value: "second" }),
  );
  if (!first.ok || !second.ok) throw new Error("Jobs were rejected");
  expect(jobs.read(second.value.id, "session")).toMatchObject({
    ok: true,
    value: { status: "queued" },
  });
  expect(jobs.read(first.value.id, "another-session")).toMatchObject({
    ok: false,
    error: { code: "PROJECT_CHANGED" },
  });
  release();
  await vi.waitFor(() =>
    expect(jobs.read(second.value.id, "session")).toMatchObject({
      ok: true,
      value: { status: "completed", result: { ok: true, value: "second" } },
    }),
  );
});

it("cancels queued work without starting it and aborts a running worker", async () => {
  const jobs = new JobQueue();
  let finish!: () => void;
  const stopped = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const first = jobs.start(
    {
      sessionId: "session",
      projectRevision: 0,
      requestId: "first",
      kind: "import",
      label: "Import",
      input: {},
    },
    async (signal) => {
      signal.addEventListener("abort", finish, { once: true });
      await stopped;
      return { ok: true, value: "Ignored after cancellation" };
    },
  );
  let secondStarted = false;
  const second = jobs.start(
    {
      sessionId: "session",
      projectRevision: 0,
      requestId: "second",
      kind: "frame",
      label: "Frame",
      input: {},
    },
    () => {
      secondStarted = true;
      return Promise.resolve({ ok: true, value: "second" });
    },
  );
  if (!first.ok || !second.ok) throw new Error("Jobs were rejected");
  expect(jobs.cancel(second.value.id, "session")).toMatchObject({
    ok: true,
    value: { status: "cancelled" },
  });
  jobs.cancel(first.value.id, "session");
  await vi.waitFor(() =>
    expect(jobs.read(first.value.id, "session")).toMatchObject({
      ok: true,
      value: {
        status: "cancelled",
        result: { ok: false, error: { code: "CANCELLED" } },
      },
    }),
  );
  expect(secondStarted).toBe(false);
});

it("enforces a cooperative deadline and shuts down its workers", async () => {
  vi.useFakeTimers();
  try {
    const jobs = new JobQueue({ timeoutMs: 10 });
    const first = jobs.start(
      {
        sessionId: "session",
        projectRevision: 0,
        requestId: "slow",
        kind: "frame",
        label: "Slow frame",
        input: {},
      },
      async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return { ok: true, value: "late" };
      },
    );
    if (!first.ok) throw new Error("Job rejected");
    await vi.advanceTimersByTimeAsync(11);
    expect(jobs.read(first.value.id, "session")).toMatchObject({
      ok: true,
      value: {
        status: "failed",
        result: { ok: false, error: { code: "TIMEOUT" } },
      },
    });
    await jobs.close();
    expect(
      jobs.start(
        {
          sessionId: "session",
          projectRevision: 0,
          requestId: "new",
          kind: "frame",
          label: "Frame",
          input: {},
        },
        () => Promise.resolve({ ok: true, value: "new" }),
      ),
    ).toMatchObject({ ok: false, error: { code: "QUEUE_CLOSED" } });
  } finally {
    vi.useRealTimers();
  }
});
