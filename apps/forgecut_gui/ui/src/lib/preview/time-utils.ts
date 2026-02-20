/** Convert microseconds to seconds */
export function usToSeconds(us: number): number {
  return us / 1_000_000;
}

/** Convert seconds to microseconds (rounded to nearest integer) */
export function secondsToUs(s: number): number {
  return Math.round(s * 1_000_000);
}

/**
 * Given a timeline playhead position, compute the seek time within the source file.
 * playheadUs: current timeline position in microseconds
 * clipStartUs: when the clip starts on the timeline in microseconds
 * sourceInUs: the in-point within the source file in microseconds
 */
export function computeSeekSeconds(
  playheadUs: number,
  clipStartUs: number,
  sourceInUs: number
): number {
  const offsetUs = playheadUs - clipStartUs;
  return usToSeconds(sourceInUs + offsetUs);
}

/**
 * Inverse of computeSeekSeconds: given a video.currentTime (seconds),
 * compute the corresponding timeline playhead position in microseconds.
 */
export function sourceTimeToPlayheadUs(
  currentTimeSec: number,
  clipStartUs: number,
  sourceInUs: number
): number {
  const sourceUs = secondsToUs(currentTimeSec);
  const offsetUs = sourceUs - sourceInUs;
  return clipStartUs + offsetUs;
}

/** Format microseconds as HH:MM:SS.mmm */
export function formatTimeUs(us: number): string {
  const totalMs = Math.floor(Math.abs(us) / 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60) % 60;
  const hr = Math.floor(totalSec / 3600);
  return `${hr.toString().padStart(2, "0")}:${min
    .toString()
    .padStart(2, "0")}:${sec.toString().padStart(2, "0")}.${ms
    .toString()
    .padStart(3, "0")}`;
}

/** Build a media URL for the local HTTP server */
export function buildMediaUrl(port: number, filePath: string): string {
  const encoded = filePath
    .split("/")
    .map((c) => encodeURIComponent(c))
    .join("/");
  return `http://127.0.0.1:${port}/${encoded}`;
}
