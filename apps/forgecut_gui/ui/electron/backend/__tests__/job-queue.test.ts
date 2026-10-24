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
