import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type Thumbnail = {
  time_seconds: number;
  data_uri: string;
};

export type WaveformData = {
  peaks: [number, number][];
  sample_rate: number;
  samples_per_peak: number;
};

export async function extractThumbnailsBase64(
  sourcePath: string,
  assetId: string,
  durationSeconds: number,
  intervalSeconds = 2,
  thumbWidth = 160,
): Promise<Thumbnail[]> {
  const assetDir = join(tmpdir(), "forgecut-thumbnails", assetId);
  await mkdir(assetDir, { recursive: true });

  const results: Thumbnail[] = [];
  for (let timeSeconds = 0; timeSeconds < durationSeconds; timeSeconds += intervalSeconds) {
    const timeUs = Math.trunc(timeSeconds * 1_000_000);
    const thumbnailPath = join(assetDir, `${timeUs}.jpg`);

    if (!(await exists(thumbnailPath))) {
      await extractThumbnail(sourcePath, thumbnailPath, timeSeconds, thumbWidth);
    }

    const bytes = await readFile(thumbnailPath);
    results.push({
      time_seconds: timeSeconds,
      data_uri: `data:image/jpeg;base64,${bytes.toString("base64")}`,
    });
  }

  return results;
}

export async function extractWaveform(
  sourcePath: string,
  assetId: string,
  samplesPerPeak = 256,
): Promise<WaveformData> {
  const cacheDir = join(tmpdir(), "forgecut-waveforms");
  const cachePath = join(cacheDir, `${assetId}.json`);

  if (await exists(cachePath)) {
    return JSON.parse(await readFile(cachePath, "utf8")) as WaveformData;
  }

  await mkdir(cacheDir, { recursive: true });

  let stdout: Buffer | string;
  try {
    ({ stdout } = await execFileAsync(
      "ffmpeg",
      [
        "-i",
        sourcePath,
        "-f",
        "s16le",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-acodec",
        "pcm_s16le",
        "-",
      ],
      { encoding: "buffer", maxBuffer: 1024 * 1024 * 128 },
    ));
  } catch {
    throw new Error("Waveform extraction failed");
  }

  const data: WaveformData = {
    peaks: computePeaks(Buffer.from(stdout), samplesPerPeak),
    sample_rate: 8000,
    samples_per_peak: samplesPerPeak,
  };

  await writeFile(cachePath, JSON.stringify(data), "utf8").catch(() => {});
  return data;
}

export function computePeaks(rawPcm: Buffer, samplesPerPeak: number): [number, number][] {
  const samples: number[] = [];
  for (let offset = 0; offset + 1 < rawPcm.length; offset += 2) {
    samples.push(rawPcm.readInt16LE(offset));
  }

  const peaks: [number, number][] = [];
  for (let index = 0; index < samples.length; index += samplesPerPeak) {
    const chunk = samples.slice(index, index + samplesPerPeak);
    if (chunk.length === 0) continue;
    peaks.push([
      Math.min(...chunk) / 32768,
      Math.max(...chunk) / 32768,
    ]);
  }

  return peaks;
}

async function extractThumbnail(
  sourcePath: string,
  outputPath: string,
  timeSeconds: number,
  width: number,
): Promise<void> {
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-ss",
      timeSeconds.toFixed(3),
      "-i",
      sourcePath,
      "-vframes",
      "1",
      "-vf",
      `scale=${width}:-1`,
      "-q:v",
      "5",
      outputPath,
    ]);
  } catch {
    throw new Error("Thumbnail extraction failed");
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
