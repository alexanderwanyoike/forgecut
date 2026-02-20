import { describe, it, expect } from "vitest";
import {
  usToSeconds,
  secondsToUs,
  computeSeekSeconds,
  sourceTimeToPlayheadUs,
  formatTimeUs,
  buildMediaUrl,
} from "../lib/preview/time-utils";

describe("usToSeconds", () => {
  it("converts 0 us to 0 seconds", () => {
    expect(usToSeconds(0)).toBe(0);
  });

  it("converts 1_000_000 us to 1 second", () => {
    expect(usToSeconds(1_000_000)).toBe(1);
  });

  it("converts 500_000 us to 0.5 seconds", () => {
    expect(usToSeconds(500_000)).toBe(0.5);
  });
});

describe("secondsToUs", () => {
  it("converts 1 second to 1_000_000 us", () => {
    expect(secondsToUs(1)).toBe(1_000_000);
  });

  it("rounds fractional microseconds", () => {
    // 0.0000005 seconds = 0.5 us → rounds to 1
    expect(secondsToUs(0.0000005)).toBe(1);
  });

  it("converts 0 to 0", () => {
    expect(secondsToUs(0)).toBe(0);
  });
});

describe("computeSeekSeconds", () => {
  it("computes seek at clip start with zero source_in", () => {
    // playhead at clip start, source_in = 0 → seek to 0s
    expect(computeSeekSeconds(1_000_000, 1_000_000, 0)).toBe(0);
  });

  it("computes seek for trimmed clip with non-zero source_in", () => {
    // playhead at clip start, source_in = 2s → seek to 2s
    expect(computeSeekSeconds(1_000_000, 1_000_000, 2_000_000)).toBe(2);
  });

  it("computes seek midway through clip", () => {
    // playhead 1.5s into a clip starting at 1s, source_in = 0 → seek to 0.5s
    expect(computeSeekSeconds(1_500_000, 1_000_000, 0)).toBe(0.5);
  });

  it("computes seek midway through trimmed clip", () => {
    // playhead 1s into clip, source_in = 3s → seek to 4s
    expect(computeSeekSeconds(2_000_000, 1_000_000, 3_000_000)).toBe(4);
  });
});

describe("sourceTimeToPlayheadUs", () => {
  it("round-trips with computeSeekSeconds", () => {
    const clipStartUs = 5_000_000;
    const sourceInUs = 2_000_000;
    const playheadUs = 7_000_000;

    const seekSec = computeSeekSeconds(playheadUs, clipStartUs, sourceInUs);
    const result = sourceTimeToPlayheadUs(seekSec, clipStartUs, sourceInUs);
    expect(result).toBe(playheadUs);
  });

  it("returns clip start when currentTime equals source_in", () => {
    const result = sourceTimeToPlayheadUs(2, 5_000_000, 2_000_000);
    expect(result).toBe(5_000_000);
  });

  it("handles zero source_in", () => {
    const result = sourceTimeToPlayheadUs(1.5, 1_000_000, 0);
    expect(result).toBe(2_500_000);
  });
});

describe("formatTimeUs", () => {
  it("formats 0 as 00:00:00.000", () => {
    expect(formatTimeUs(0)).toBe("00:00:00.000");
  });

  it("formats 1 second", () => {
    expect(formatTimeUs(1_000_000)).toBe("00:00:01.000");
  });

  it("formats 1h23m45.678s", () => {
    const us = ((1 * 3600 + 23 * 60 + 45) * 1000 + 678) * 1000;
    expect(formatTimeUs(us)).toBe("01:23:45.678");
  });

  it("formats sub-second values", () => {
    expect(formatTimeUs(500_000)).toBe("00:00:00.500");
  });
});

describe("buildMediaUrl", () => {
  it("builds correct URL with port and path", () => {
    const url = buildMediaUrl(8080, "/home/user/video.mp4");
    // Leading empty segment from split("/") produces the leading /
    // Path components are individually encoded but / separators are preserved
    expect(url).toBe("http://127.0.0.1:8080//home/user/video.mp4");
  });

  it("preserves / separators", () => {
    const url = buildMediaUrl(9000, "media/clip.mp4");
    expect(url).toContain("127.0.0.1:9000");
    expect(url).toContain("/");
  });

  it("encodes spaces", () => {
    const url = buildMediaUrl(8080, "my videos/clip 1.mp4");
    expect(url).toContain("my%20videos");
    expect(url).toContain("clip%201.mp4");
  });
});
