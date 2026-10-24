/** @vitest-environment node */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import type { GraphicPreviewInput } from "../../shared/graphic-preview";
import { GraphicPreviewHost } from "../GraphicPreviewHost";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn().mockResolvedValue(undefined),
  budget: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({ mkdtemp: mocks.mkdir, rm: mocks.rm }));
vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
  execFile: vi.fn(),
}));
vi.mock("../process-budget", () => ({ budgetedMediaCommand: mocks.budget }));
vi.mock("../graphic-render", () => ({
  graphicRuntimeDirectory: () => "/runtime",
}));
const input: GraphicPreviewInput = {
  key: "a".repeat(64),
  code: "module.exports.default=()=>null",
  resources: {},
  values: {},
  width: 64,
  height: 36,
  fps: 10,
  duration: 10,
  frame: 0,
};
function child() {
  const process = new EventEmitter();
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const stderr = new PassThrough();
  const value = Object.assign(process, {
    stdout,
    stdin,
    stderr,
    kill: vi.fn(() => {
      queueMicrotask(() => process.emit("close", 0));
      return true;
    }),
  });
  stdin.on("data", (line: Buffer) => {
    const request = JSON.parse(line.toString()) as { id: number; kind: string };
    queueMicrotask(() =>
      stdout.write(
        JSON.stringify({
          ok: true,
          id: request.id,
          value:
            request.kind === "load"
              ? "loaded"
              : { mimeType: "image/png", data: "AA==", width: 64, height: 36 },
        }) + "\n",
      ),
    );
  });
  queueMicrotask(() =>
    stdout.write(JSON.stringify({ ok: true, id: 0, value: "ready" }) + "\n"),
  );
  return value;
}
afterEach(() => vi.clearAllMocks());
for (const action of ["close", "reset", "abort"] as const) {
  it.skipIf(process.platform !== "linux")(
    `does not spawn after ${action} interrupts preview startup`,
    async () => {
      let release!: (directory: string) => void;
      mocks.mkdir.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            release = resolve;
          }),
      );
      mocks.budget.mockResolvedValue({
        command: "fake",
        args: [],
        unit: "fake.scope",
      });
      mocks.spawn.mockImplementation(child);
      const host = new GraphicPreviewHost();
      const controller = new AbortController();
      const rendering = host.render(input, controller.signal);
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      const closing =
        action === "abort"
          ? Promise.resolve(controller.abort())
          : host[action]();
      release("/tmp/preview-startup");
      await closing;
      expect(await rendering).toMatchObject({ ok: false });
      expect(mocks.spawn).not.toHaveBeenCalled();
      expect(mocks.rm).toHaveBeenCalledWith("/tmp/preview-startup", {
        recursive: true,
        force: true,
      });
      await host.close();
    },
  );
}
it.skipIf(process.platform !== "linux")(
  "cleans the previous context after an idle worker crash before restarting",
  async () => {
    mocks.mkdir
      .mockResolvedValueOnce("/tmp/preview-one")
      .mockResolvedValueOnce("/tmp/preview-two");
    mocks.budget.mockResolvedValue({
      command: "fake",
      args: [],
      unit: "fake.scope",
    });
    const children: ReturnType<typeof child>[] = [];
    mocks.spawn.mockImplementation(() => {
      const process = child();
      children.push(process);
      return process;
    });
    const host = new GraphicPreviewHost();
    try {
      expect(await host.render(input)).toMatchObject({ ok: true });
      children[0].emit("close", 1);
      expect(await host.render(input)).toMatchObject({ ok: true });
    } finally {
      await host.close();
    }
    expect(mocks.rm.mock.calls.map(([directory]) => directory)).toEqual([
      "/tmp/preview-one",
      "/tmp/preview-two",
    ]);
  },
);
