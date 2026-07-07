import { describe, it, expect } from "vitest";
import {
  mediaMimeType,
  mediaResponseInit,
  parseByteRange,
} from "../media-protocol";

describe("parseByteRange", () => {
  it("returns null when no Range header is present", () => {
    expect(parseByteRange(null, 1000)).toBeNull();
  });

  it("parses a bounded range", () => {
    expect(parseByteRange("bytes=100-199", 1000)).toEqual({ start: 100, end: 199 });
  });

  it("parses an open-ended range", () => {
    expect(parseByteRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("parses a suffix range", () => {
    expect(parseByteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("clamps a suffix range larger than the file", () => {
    expect(parseByteRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("clamps end to the file size", () => {
    expect(parseByteRange("bytes=0-99999", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("uses the first range of a multi-range request", () => {
    expect(parseByteRange("bytes=0-1,5-6", 1000)).toEqual({ start: 0, end: 1 });
  });

  it("is unsatisfiable when start is past the end of the file", () => {
    expect(parseByteRange("bytes=1000-", 1000)).toBe("unsatisfiable");
  });

  it("is unsatisfiable when end is before start", () => {
    expect(parseByteRange("bytes=200-100", 1000)).toBe("unsatisfiable");
  });

  it("treats malformed headers as a full-file request", () => {
    expect(parseByteRange("bytes=abc", 1000)).toBeNull();
    expect(parseByteRange("chunks=0-1", 1000)).toBeNull();
    expect(parseByteRange("bytes=-", 1000)).toBeNull();
  });
});

describe("mediaResponseInit", () => {
  it("serves the full file with Accept-Ranges when no range is requested", () => {
    const init = mediaResponseInit(null, 1000, "/tmp/clip.mp4");
    expect(init.status).toBe(200);
    expect(init.range).toBeUndefined();
    expect(init.headers["Content-Length"]).toBe("1000");
    expect(init.headers["Accept-Ranges"]).toBe("bytes");
    expect(init.headers["Content-Type"]).toBe("video/mp4");
  });

  it("serves a partial response for a range request", () => {
    const init = mediaResponseInit("bytes=100-199", 1000, "/tmp/clip.mp4");
    expect(init.status).toBe(206);
    expect(init.range).toEqual({ start: 100, end: 199 });
    expect(init.headers["Content-Length"]).toBe("100");
    expect(init.headers["Content-Range"]).toBe("bytes 100-199/1000");
  });

  it("serves an open-ended range to the end of the file", () => {
    const init = mediaResponseInit("bytes=900-", 1000, "/tmp/clip.mp4");
    expect(init.status).toBe(206);
    expect(init.headers["Content-Range"]).toBe("bytes 900-999/1000");
  });

  it("responds 416 for an unsatisfiable range", () => {
    const init = mediaResponseInit("bytes=5000-", 1000, "/tmp/clip.mp4");
    expect(init.status).toBe(416);
    expect(init.headers["Content-Range"]).toBe("bytes */1000");
  });
});

describe("mediaMimeType", () => {
  it("maps common media extensions", () => {
    expect(mediaMimeType("/a/b/clip.MP4")).toBe("video/mp4");
    expect(mediaMimeType("/a/b/audio.wav")).toBe("audio/wav");
    expect(mediaMimeType("/a/b/image.jpeg")).toBe("image/jpeg");
  });

  it("falls back to octet-stream for unknown extensions", () => {
    expect(mediaMimeType("/a/b/file.xyz")).toBe("application/octet-stream");
  });
});
