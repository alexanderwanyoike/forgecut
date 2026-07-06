/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { computePeaks } from "../media-derived";

function pcm16le(samples: number[]): Buffer {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, index * 2));
  return buffer;
}

describe("Electron media derived helpers", () => {
  it("computes min/max waveform peaks from signed 16-bit PCM", () => {
    const peaks = computePeaks(
      pcm16le([0, 100, -200, 300, -400, 500, -600, 700]),
      4,
    );

    expect(peaks).toHaveLength(2);
    expect(peaks[0][0]).toBeCloseTo(-200 / 32768, 6);
    expect(peaks[0][1]).toBeCloseTo(300 / 32768, 6);
    expect(peaks[1][0]).toBeCloseTo(-600 / 32768, 6);
    expect(peaks[1][1]).toBeCloseTo(700 / 32768, 6);
  });

  it("returns no peaks for empty PCM", () => {
    expect(computePeaks(Buffer.alloc(0), 256)).toEqual([]);
  });

  it("computes a partial final peak", () => {
    const peaks = computePeaks(pcm16le([1000, -1000, 500]), 4);

    expect(peaks).toHaveLength(1);
    expect(peaks[0][0]).toBeCloseTo(-1000 / 32768, 6);
    expect(peaks[0][1]).toBeCloseTo(1000 / 32768, 6);
  });
});
