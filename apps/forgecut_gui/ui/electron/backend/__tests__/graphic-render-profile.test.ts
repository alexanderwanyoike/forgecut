/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { renderGraphic } from "../graphic-render";
import { renderEncoding, type GraphicRenderJob } from "../graphic-render-job";

const worker = vi.hoisted(() => ({
  run: vi.fn().mockResolvedValue({ ok: true, value: null }),
}));
vi.mock("../graphic-worker-process", () => ({ runGraphicWorker: worker.run }));
vi.mock("node:fs", () => ({ existsSync: () => true }));
vi.mock("node:fs/promises", () => ({ writeFile: vi.fn() }));

const job = (format: GraphicRenderJob["format"]): GraphicRenderJob => ({
  format,
  output: `/job/out.${format}`,
  sourceHash: "a".repeat(64),
  code: "module.exports.default=()=>null",
  width: 1920,
  height: 1080,
  fps: 60,
  duration: 72,
  renderFrames: 72,
  values: {},
  resources: {},
});

it("captures preview frames in parallel within a larger CPU share than export", async () => {
  await renderGraphic(job("webm"), "/job");
  await renderGraphic(job("prores"), "/job");
  expect(worker.run.mock.calls.map((call) => call.at(-1))).toEqual([400, 150]);
  expect(renderEncoding(job("webm")).concurrency).toBe(3);
  expect(renderEncoding(job("prores")).concurrency).toBe(1);
});
