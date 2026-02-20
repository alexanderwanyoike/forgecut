/**
 * SeekController serializes seeks on an HTMLVideoElement to avoid
 * WebKitGTK's freeze when setting currentTime while a seek is in progress
 * (WebKit Bug 194499). Only the latest pending seek is kept; intermediate
 * positions during rapid scrubbing are discarded.
 */

type SeekState = "idle" | "seeking";

export class SeekController {
  private video: HTMLVideoElement | null = null;
  private state: SeekState = "idle";
  private pending: number | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private seekedCallback: (() => void) | null = null;
  private boundOnSeeked: (() => void) | null = null;

  /** Bind to a video element; listens for the 'seeked' event */
  attach(video: HTMLVideoElement): void {
    this.detach();
    this.video = video;
    this.boundOnSeeked = this.handleSeeked.bind(this);
    this.video.addEventListener("seeked", this.boundOnSeeked);
  }

  /** Remove event listener and clear state */
  detach(): void {
    if (this.video && this.boundOnSeeked) {
      this.video.removeEventListener("seeked", this.boundOnSeeked);
    }
    this.video = null;
    this.boundOnSeeked = null;
    this.state = "idle";
    this.pending = null;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /** Request a seek. If idle, seeks immediately. If busy, queues (latest wins). */
  requestSeek(timeSeconds: number): void {
    if (!this.video) return;

    if (this.state === "idle") {
      this.state = "seeking";
      this.video.currentTime = timeSeconds;
    } else {
      // Already seeking — store as pending (latest wins)
      this.pending = timeSeconds;
    }
  }

  /** Register a callback fired after each seek completes */
  onSeeked(callback: () => void): void {
    this.seekedCallback = callback;
  }

  /** Clear any pending seek (e.g. when switching clips) */
  reset(): void {
    this.pending = null;
    this.state = "idle";
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  get isSeeking(): boolean {
    return this.state === "seeking";
  }

  private handleSeeked(): void {
    this.seekedCallback?.();

    if (this.pending !== null) {
      const next = this.pending;
      this.pending = null;
      // 16ms debounce lets GStreamer's pipeline settle between seeks
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        if (this.video) {
          this.video.currentTime = next;
          // stay in "seeking" state
        }
      }, 16);
    } else {
      this.state = "idle";
    }
  }
}
