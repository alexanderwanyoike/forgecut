/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { encodePreviewProxy } from "../preview-proxy";

const media = vi.hoisted(() => ({
  run: vi.fn().mockResolvedValue({ ok: true, value: Buffer.alloc(0) }),
}));
vi.mock("../media-process", () => ({ runMediaProcess: media.run }));

it("encodes proxies behind the graphic renders a viewer is waiting for", async () => {
  await encodePreviewProxy("/footage/recording.mkv", "/cache/proxy.mp4");
  expect(media.run).toHaveBeenCalledWith(
    "ffmpeg",
    expect.any(Array),
    expect.objectContaining({ cpuPercent: 400, cpuWeight: 10 }),
  );
});
