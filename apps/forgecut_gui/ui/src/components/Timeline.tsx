import { createSignal, For, onMount, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

interface TimelineData {
  tracks: Track[];
  markers: any[];
}

interface Track {
  id: string;
  kind: string;
  items: Item[];
}

interface Item {
  [key: string]: any;
}

function getItemData(item: Item) {
  const variant = Object.keys(item)[0];
  const data = item[variant];
  const startUs = data.timeline_start_us;
  const durationUs =
    variant === "VideoClip" || variant === "AudioClip"
      ? data.source_out_us - data.source_in_us
      : data.duration_us;
  return { variant, ...data, startUs, durationUs };
}

interface TimelineProps {
  playheadUs: number;
  playing: boolean;
  onPlayheadChange: (us: number) => void;
  selectedClipId: string | null;
  onSelectedClipChange: (id: string | null) => void;
}

export default function Timeline(props: TimelineProps) {
  const [timeline, setTimeline] = createSignal<TimelineData>({
    tracks: [],
    markers: [],
  });
  const [pixelsPerSecond, setPixelsPerSecond] = createSignal(100);
  const [scrollLeft, setScrollLeft] = createSignal(0);

  const selectedClipId = () => props.selectedClipId;
  const setSelectedClipId = (id: string | null) => props.onSelectedClipChange(id);

  // Drag state for moving clips
  const [dragState, setDragState] = createSignal<{
    itemId: string;
    startMouseX: number;
    originalStartUs: number;
  } | null>(null);

  // Drag state for trimming clips
  const [trimState, setTrimState] = createSignal<{
    itemId: string;
    edge: "left" | "right";
    startMouseX: number;
    originalUs: number;
  } | null>(null);

  let timelineRef: HTMLDivElement | undefined;

  onMount(async () => {
    const tl = await invoke<TimelineData>("init_default_tracks");
    setTimeline(tl);
  });

  const usToPixels = (us: number) => (us / 1_000_000) * pixelsPerSecond();
  const pixelsToUs = (px: number) => (px / pixelsPerSecond()) * 1_000_000;

  const totalWidth = () => {
    let maxEnd = 30_000_000;
    for (const track of timeline().tracks) {
      for (const item of track.items) {
        const data = getItemData(item);
        const end = data.startUs + data.durationUs;
        if (end > maxEnd) maxEnd = end;
      }
    }
    return usToPixels(maxEnd + 5_000_000);
  };

  // Keyboard shortcuts
  const handleKeyDown = async (e: KeyboardEvent) => {
    // Space bar: play/pause (let it bubble -- handled by Preview)

    // Undo: Ctrl+Z
    if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault();
      try {
        const tl = await invoke<TimelineData>("undo");
        setTimeline(tl);
      } catch (_) {}
      return;
    }

    // Redo: Ctrl+Shift+Z
    if (e.key === "Z" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      try {
        const tl = await invoke<TimelineData>("redo");
        setTimeline(tl);
      } catch (_) {}
      return;
    }

    const sel = selectedClipId();
    if (!sel) return;

    // Delete selected clip
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      try {
        const tl = await invoke<TimelineData>("delete_clip", { itemId: sel });
        setTimeline(tl);
        setSelectedClipId(null);
      } catch (err) {
        console.error("delete_clip failed:", err);
      }
      return;
    }

    // Split at playhead
    if ((e.key === "s" || e.key === "S") && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      try {
        const tl = await invoke<TimelineData>("split_clip", {
          itemId: sel,
          splitTimeUs: props.playheadUs,
        });
        setTimeline(tl);
      } catch (err) {
        console.error("split_clip failed:", err);
      }
      return;
    }
  };

  onMount(() => window.addEventListener("keydown", handleKeyDown));
  onCleanup(() => window.removeEventListener("keydown", handleKeyDown));

  // Global mouse move/up for drag and trim
  const handleGlobalMouseUp = async (e: MouseEvent) => {
    const ds = dragState();
    const ts = trimState();

    if (ds) {
      const dx = e.clientX - ds.startMouseX;
      const deltaUs = pixelsToUs(dx);
      const newStartUs = Math.max(0, Math.round(ds.originalStartUs + deltaUs));
      setDragState(null);
      if (Math.abs(dx) < 3) return;
      try {
        const tl = await invoke<TimelineData>("move_clip", {
          itemId: ds.itemId,
          newStartUs,
        });
        setTimeline(tl);
      } catch (err) {
        console.error("move_clip failed:", err);
      }
      return;
    }

    if (ts) {
      const dx = e.clientX - ts.startMouseX;
      const deltaUs = pixelsToUs(dx);
      const newUs = Math.max(0, Math.round(ts.originalUs + deltaUs));
      setTrimState(null);
      if (Math.abs(dx) < 3) return;
      try {
        const tl = await invoke<TimelineData>("trim_clip", {
          itemId: ts.itemId,
          trimType: ts.edge === "left" ? "in" : "out",
          newUs,
        });
        setTimeline(tl);
      } catch (err) {
        console.error("trim_clip failed:", err);
      }
      return;
    }
  };

  onMount(() => {
    window.addEventListener("mouseup", handleGlobalMouseUp);
  });
  onCleanup(() => {
    window.removeEventListener("mouseup", handleGlobalMouseUp);
  });

  const handleDrop = async (e: DragEvent, trackId: string) => {
    e.preventDefault();
    const assetJson = e.dataTransfer?.getData("application/forgecut-asset");
    if (!assetJson) return;
    const asset = JSON.parse(assetJson);

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left + scrollLeft();
    const startUs = Math.max(0, Math.round(pixelsToUs(x)));

    const tl = await invoke<TimelineData>("add_clip_to_timeline", {
      assetId: asset.id,
      trackId: trackId,
      timelineStartUs: startUs,
    });
    setTimeline(tl);
  };

  const handleRulerClick = (e: MouseEvent) => {
    if (props.playing) return; // Don't move playhead during playback
    if (!timelineRef) return;
    const rect = timelineRef.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollLeft();
    const us = Math.max(0, Math.round(pixelsToUs(x)));
    props.onPlayheadChange(us);
  };

  const handleClipMouseDown = (e: MouseEvent, itemId: string, startUs: number) => {
    if ((e.target as HTMLElement).classList.contains("trim-handle")) return;
    e.stopPropagation();
    setSelectedClipId(itemId);
    setDragState({ itemId, startMouseX: e.clientX, originalStartUs: startUs });
  };

  const handleTrimMouseDown = (
    e: MouseEvent,
    itemId: string,
    edge: "left" | "right",
    currentUs: number
  ) => {
    e.stopPropagation();
    setSelectedClipId(itemId);
    setTrimState({ itemId, edge, startMouseX: e.clientX, originalUs: currentUs });
  };

  const trackColor = (kind: string) => {
    switch (kind) {
      case "Video": return "#4a9eff";
      case "Audio": return "#4aff7f";
      case "OverlayImage": return "#c840e9";
      case "OverlayText": return "#e9a840";
      default: return "#ff9f4a";
    }
  };

  const handleAddText = async () => {
    try {
      const tl = await invoke<TimelineData>("add_text_overlay", {
        trackId: "00000000-0000-0000-0000-000000000000",
        timelineStartUs: props.playheadUs,
        durationUs: 3_000_000,
        text: "Hello World",
        fontSize: 48,
        color: "#ffffff",
        x: 100,
        y: 100,
      });
      setTimeline(tl);
    } catch (err) {
      console.error("add_text_overlay failed:", err);
    }
  };

  const renderRuler = () => {
    const width = totalWidth();
    const interval = pixelsPerSecond() >= 80 ? 1 : pixelsPerSecond() >= 40 ? 2 : 5;
    const ticks = [];
    for (let sec = 0; sec * pixelsPerSecond() < width; sec += interval) {
      ticks.push(sec);
    }
    return ticks;
  };

  return (
    <section class="panel timeline">
      <div class="timeline-controls">
        <span class="timeline-label">Timeline</span>
        <button class="add-text-btn" onClick={handleAddText}>+ Text</button>
        <div class="zoom-control">
          <button onClick={() => setPixelsPerSecond((p) => Math.max(20, p - 20))}>-</button>
          <span>{pixelsPerSecond()}px/s</span>
          <button onClick={() => setPixelsPerSecond((p) => Math.min(300, p + 20))}>+</button>
        </div>
      </div>

      <div
        class="timeline-scroll"
        ref={timelineRef}
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
        onMouseDown={() => setSelectedClipId(null)}
      >
        <div class="timeline-content" style={{ width: `${totalWidth()}px` }}>
          <div class="time-ruler" onMouseDown={handleRulerClick}>
            <For each={renderRuler()}>
              {(sec) => (
                <div class="ruler-tick" style={{ left: `${sec * pixelsPerSecond()}px` }}>
                  <span class="ruler-label">{formatTimecode(sec)}</span>
                </div>
              )}
            </For>
          </div>

          <div class="playhead" style={{ left: `${usToPixels(props.playheadUs)}px` }} />

          <div class="track-lanes">
            <For each={timeline().tracks}>
              {(track, trackIndex) => (
                <div
                  class="track-lane"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDrop(e, track.id)}
                >
                  <div class="track-label">
                    {track.kind === "Video" ? "V" : track.kind === "Audio" ? "A" : track.kind === "OverlayImage" ? "Img" : track.kind === "OverlayText" ? "T" : "?"}
                    {trackIndex() + 1}
                  </div>
                  <div class="track-content">
                    <For each={track.items}>
                      {(item) => {
                        const data = getItemData(item);
                        const isSelected = () => selectedClipId() === data.id;
                        return (
                          <div
                            class={`clip${isSelected() ? " clip-selected" : ""}`}
                            style={{
                              left: `${usToPixels(data.startUs)}px`,
                              width: `${Math.max(4, usToPixels(data.durationUs))}px`,
                              "background-color": trackColor(track.kind),
                            }}
                            onMouseDown={(e) => handleClipMouseDown(e, data.id, data.startUs)}
                          >
                            <div
                              class="trim-handle trim-handle-left"
                              onMouseDown={(e) =>
                                handleTrimMouseDown(
                                  e, data.id, "left",
                                  data.variant === "VideoClip" || data.variant === "AudioClip"
                                    ? data.source_in_us : data.startUs
                                )
                              }
                            />
                            <span class="clip-label">
                              {data.variant === "AudioClip" ? "Audio" : data.variant === "VideoClip" ? "Video" : data.variant === "ImageOverlay" ? "Image" : data.variant === "TextOverlay" ? data.text || "Text" : data.variant}
                            </span>
                            <div
                              class="trim-handle trim-handle-right"
                              onMouseDown={(e) =>
                                handleTrimMouseDown(
                                  e, data.id, "right",
                                  data.variant === "VideoClip" || data.variant === "AudioClip"
                                    ? data.source_out_us : data.startUs + data.durationUs
                                )
                              }
                            />
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </section>
  );
}

function formatTimecode(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}
