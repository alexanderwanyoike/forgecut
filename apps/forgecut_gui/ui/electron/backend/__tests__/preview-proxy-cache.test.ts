/** @vitest-environment node */
import { existsSync } from "node:fs";
import { appendFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { PreviewProxyCache } from "../PreviewProxyCache";
import { needsPreviewProxy } from "../preview-proxy";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

async function workspace() {
  const path = await mkdtemp(join(tmpdir(), "forgecut-proxy-test-"));
  directories.push(path);
  const root = join(path, "cache");
  const source = async (name: string) => {
    const file = join(path, name);
    await writeFile(file, name);
    return file;
  };
  return { root, source };
}

const slow = async () => ({ ok: true as const, value: [0, 2.1, 4.1, 6.1] });
const fast = async () => ({
  ok: true as const,
  value: Array.from({ length: 40 }, (_, index) => index * 0.25),
});

function encoder(bytes = 10) {
  return vi.fn(async (_source: string, output: string) => {
    await writeFile(output, "x".repeat(bytes));
    return { ok: true as const, value: null };
  });
}

it("asks for a proxy only when keyframes are more than half a second apart", () => {
  expect(needsPreviewProxy([0, 0.5, 1], 10)).toBe(false);
  expect(needsPreviewProxy([0, 2.1, 4.1], 10)).toBe(true);
  expect(needsPreviewProxy([0], 10)).toBe(true);
  expect(needsPreviewProxy([0], 0.4)).toBe(false);
});

it("plays fast-seeking sources directly", async () => {
  const { root, source } = await workspace();
  const encode = encoder();
  const proxies = new PreviewProxyCache({ root, probe: fast, encode });
  expect(await proxies.prepare(await source("phone.mp4"))).toEqual({
    ok: true,
    value: undefined,
  });
  expect(encode).not.toHaveBeenCalled();
  await proxies.close();
});

it("encodes a slow-seeking source once and keeps it across restarts", async () => {
  const { root, source } = await workspace();
  const recording = await source("recording.mkv");
  const encode = encoder();
  const first = new PreviewProxyCache({ root, probe: slow, encode });
  const [prepared, shared] = await Promise.all([
    first.prepare(recording),
    first.prepare(recording),
  ]);
  if (!prepared.ok || !prepared.value) throw new Error("No proxy");
  expect(shared).toEqual(prepared);
  expect(existsSync(prepared.value)).toBe(true);
  expect(first.owns(prepared.value)).toBe(true);
  expect(first.owns(recording)).toBe(false);
  await first.close();
  const restarted = new PreviewProxyCache({ root, probe: slow, encode });
  expect(await restarted.prepare(recording)).toEqual(prepared);
  expect(restarted.owns(prepared.value)).toBe(true);
  expect(encode).toHaveBeenCalledTimes(1);
  await restarted.close();
});

it("encodes again when the source file changes", async () => {
  const { root, source } = await workspace();
  const recording = await source("recording.mkv");
  const encode = encoder();
  const proxies = new PreviewProxyCache({ root, probe: slow, encode });
  const before = await proxies.prepare(recording);
  await appendFile(recording, " more footage");
  const after = await proxies.prepare(recording);
  expect(after).toMatchObject({ ok: true });
  expect(after).not.toEqual(before);
  expect(encode).toHaveBeenCalledTimes(2);
  await proxies.close();
});

it("removes the least recently used proxies beyond its size cap", async () => {
  const { root, source } = await workspace();
  const encode = encoder(10);
  const proxies = new PreviewProxyCache({
    root,
    probe: slow,
    encode,
    capBytes: 25,
  });
  const recording = await source("first.mkv");
  const first = await proxies.prepare(recording);
  const second = await proxies.prepare(await source("second.mkv"));
  await proxies.prepare(recording);
  const third = await proxies.prepare(await source("third.mkv"));
  if (!first.ok || !second.ok || !third.ok) throw new Error("No proxy");
  expect(existsSync(first.value!)).toBe(true);
  expect(existsSync(second.value!)).toBe(false);
  expect(existsSync(third.value!)).toBe(true);
  await proxies.close();
});

it("abandons an encode when closed and leaves no partial file", async () => {
  const { root, source } = await workspace();
  const recording = await source("recording.mkv");
  let started!: () => void;
  const running = new Promise<void>((done) => {
    started = done;
  });
  const encode = vi.fn(
    async (_source: string, output: string, signal?: AbortSignal) => {
      await writeFile(output, "partial");
      started();
      await new Promise((done) =>
        signal?.addEventListener("abort", done, { once: true }),
      );
      return {
        ok: false as const,
        error: { code: "CANCELLED", message: "Media operation cancelled." },
      };
    },
  );
  const proxies = new PreviewProxyCache({ root, probe: slow, encode });
  const prepared = proxies.prepare(recording);
  await running;
  await proxies.close();
  expect(await prepared).toMatchObject({
    ok: false,
    error: { code: "CANCELLED" },
  });
  expect(await readdir(root)).toEqual([]);
});

it("waits for interactive work before it starts encoding", async () => {
  const { root, source } = await workspace();
  const encode = encoder();
  let finish!: () => void;
  const busy = new Promise<void>((done) => {
    finish = done;
  });
  const proxies = new PreviewProxyCache({
    root,
    probe: slow,
    encode,
    yieldTo: () => busy,
  });
  const prepared = proxies.prepare(await source("recording.mkv"));
  await new Promise((done) => setTimeout(done, 20));
  expect(encode).not.toHaveBeenCalled();
  finish();
  expect(await prepared).toMatchObject({ ok: true });
  expect(encode).toHaveBeenCalledTimes(1);
  await proxies.close();
});
