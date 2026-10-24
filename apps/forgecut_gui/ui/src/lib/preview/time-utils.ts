/** Convert microseconds to seconds */
export function usToSeconds(us: number): number {
  return us / 1_000_000;
}

/** Convert seconds to microseconds (rounded to nearest integer) */
export function secondsToUs(s: number): number {
  return Math.round(s * 1_000_000);
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
