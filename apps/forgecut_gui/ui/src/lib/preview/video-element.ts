/**
 * HTMLVideoElement helpers for preview playback. jsdom (tests) lacks real
 * media support, so each helper degrades to a no-op there.
 */

const isJsdom = () => navigator.userAgent.includes("jsdom");

export function loadVideo(video: HTMLVideoElement): void {
  if (isJsdom()) return;
  video.load();
}

export function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  if (isJsdom()) return Promise.resolve();
  if (Number.isFinite(video.duration) && video.readyState >= 1) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Failed to load video"));
    };
    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function waitForSeek(video: HTMLVideoElement): Promise<void> {
  if (isJsdom()) return Promise.resolve();

  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", onDone);
      video.removeEventListener("error", onDone);
    };
    const onDone = () => {
      cleanup();
      resolve();
    };
    video.addEventListener("seeked", onDone, { once: true });
    video.addEventListener("error", onDone, { once: true });
    timer = setTimeout(onDone, 1200);
  });
}

export async function seekVideo(video: HTMLVideoElement, targetTime: number): Promise<void> {
  if (Math.abs(video.currentTime - targetTime) < 0.03) return;
  const seeked = waitForSeek(video);
  video.currentTime = targetTime;
  await seeked;
}
