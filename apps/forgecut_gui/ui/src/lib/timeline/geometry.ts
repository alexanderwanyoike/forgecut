/**
 * Pure timeline coordinate and zoom math. No React, no IPC — everything here
 * is unit-testable with plain numbers.
 */

/** Width of the track label column in pixels */
export const LABEL_W = 48;
export const TIMELINE_ZOOM_MIN = 1;
export const TIMELINE_ZOOM_MAX = 500;
export const TIMELINE_ZOOM_STEP_FACTOR = 0.9;

export function clampZoom(pixelsPerSecond: number) {
  return Math.max(TIMELINE_ZOOM_MIN, Math.min(TIMELINE_ZOOM_MAX, pixelsPerSecond));
}

export function zoomOutLevel(pixelsPerSecond: number) {
  if (pixelsPerSecond <= TIMELINE_ZOOM_MIN) return TIMELINE_ZOOM_MIN;
  return clampZoom(Math.floor(pixelsPerSecond * TIMELINE_ZOOM_STEP_FACTOR));
}

export function zoomInLevel(pixelsPerSecond: number) {
  if (pixelsPerSecond >= TIMELINE_ZOOM_MAX) return TIMELINE_ZOOM_MAX;
  return clampZoom(Math.ceil(pixelsPerSecond / TIMELINE_ZOOM_STEP_FACTOR));
}

/** Seconds between ruler ticks at a given zoom. */
export function timelineRulerInterval(pixelsPerSecond: number) {
  if (pixelsPerSecond >= 80) return 1;
  if (pixelsPerSecond >= 40) return 2;
  if (pixelsPerSecond >= 16) return 5;
  if (pixelsPerSecond >= 8) return 10;
  if (pixelsPerSecond >= 4) return 30;
  return 60;
}

export function minimapViewport(
  viewWidth: number,
  timelineWidth: number,
  scrollLeft: number,
) {
  const viewportWidth = Math.max(0, viewWidth);
  const contentWidth = Math.max(timelineWidth, viewportWidth, 1);
  const widthPercent = Math.min(100, (viewportWidth / contentWidth) * 100);
  const scrollableWidth = Math.max(contentWidth - viewportWidth, 0);
  const leftPercent =
    scrollableWidth > 0
      ? Math.min(100 - widthPercent, (Math.max(0, scrollLeft) / scrollableWidth) * (100 - widthPercent))
      : 0;

  return { leftPercent, widthPercent };
}

/** Map a mouse clientX to a timeline position in microseconds. */
export function timelinePointerUs(
  clientX: number,
  timelineLeft: number,
  scrollLeft: number,
  pixelsPerSecond: number,
) {
  const x = clientX - timelineLeft + scrollLeft - LABEL_W;
  return Math.max(0, Math.round((x / pixelsPerSecond) * 1_000_000));
}

export function usToPixels(us: number, pixelsPerSecond: number) {
  return (us / 1_000_000) * pixelsPerSecond;
}

export function pixelsToUs(px: number, pixelsPerSecond: number) {
  return (px / pixelsPerSecond) * 1_000_000;
}

/** Nearest snap point within threshold, or null. */
export function nearestSnapPoint(
  positionUs: number,
  snapPoints: number[],
  thresholdUs: number,
): number | null {
  let bestDist = thresholdUs + 1;
  let bestPoint: number | null = null;
  for (const point of snapPoints) {
    const dist = Math.abs(positionUs - point);
    if (dist < bestDist) {
      bestDist = dist;
      bestPoint = point;
    }
  }
  return bestDist <= thresholdUs ? bestPoint : null;
}

export function formatTimecode(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}
