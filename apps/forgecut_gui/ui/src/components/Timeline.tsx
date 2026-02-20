import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

/** Width of the track label column in pixels */
const LABEL_W = 48;

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
  onPlayingChange: (playing: boolean) => void;
  selectedClipId: string | null;
  onSelectedClipChange: (id: string | null) => void;
}

export default function Timeline(props: TimelineProps) {
  const [timeline, setTimeline] = useState<TimelineData>({
    tracks: [],
    markers: [],
  });
  const [pixelsPerSecond, setPixelsPerSecond] = useState(100);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [snapping, setSnapping] = useState(true);
  const [snapLineUs, setSnapLineUs] = useState<number | null>(null);

  const selectedClipId = props.selectedClipId;
  const setSelectedClipId = (id: string | null) => props.onSelectedClipChange(id);

  // Drag state for moving clips
  const [dragState, setDragState] = useState<{
    itemId: string;
    startMouseX: number;
    startMouseY: number;
    originalStartUs: number;
    trackId: string;
    trackKind: string;
  } | null>(null);

  // Track the target track during cross-track drag
  const [dragTargetTrackId, setDragTargetTrackId] = useState<string | null>(null);

  // Drag state for trimming clips
  const [trimState, setTrimState] = useState<{
    itemId: string;
    edge: "left" | "right";
    startMouseX: number;
    originalUs: number;
  } | null>(null);

  const [viewWidth, setViewWidth] = useState(0);

  // Waveform cache: asset_id -> peaks array
  const [waveforms, setWaveforms] = useState<Record<string, number[][]>>({});

  // Thumbnail cache: asset_id -> {time_seconds, url}[]
  const [thumbnails, setThumbnails] = useState<Record<string, { time_seconds: number; url: string }[]>>({});

  // Track which assets have thumbnails currently loading (reactive, for shimmer UI)
  const [thumbnailsLoading, setThumbnailsLoading] = useState<Record<string, boolean>>({});

  const timelineRef = useRef<HTMLDivElement>(null);
  const rulerDraggingRef = useRef(false);
  const snapPointsCacheRef = useRef<number[] | null>(null);

  const fetchWaveform = useCallback(async (assetId: string) => {
    if (waveforms[assetId]) return;
    try {
      const data = await invoke<{ peaks: [number, number][]; sample_rate: number; samples_per_peak: number }>("get_waveform", { assetId });
      setWaveforms((prev) => ({ ...prev, [assetId]: data.peaks }));
    } catch (_) {
      // Waveform extraction may fail for non-audio files; silently ignore
    }
  }, [waveforms]);

  // Track in-flight thumbnail fetches to avoid duplicate requests
  const thumbnailsLoadingRef = useRef<Record<string, boolean>>({});

  const fetchThumbnails = useCallback(async (assetId: string) => {
    if (thumbnails[assetId] || thumbnailsLoadingRef.current[assetId]) return;
    thumbnailsLoadingRef.current[assetId] = true;
    setThumbnailsLoading((prev) => ({ ...prev, [assetId]: true }));
    try {
      const data = await invoke<{ time_seconds: number; data_uri: string }[]>("get_clip_thumbnails", { assetId });
      const mapped = data.map((t) => ({ time_seconds: t.time_seconds, url: t.data_uri }));
      setThumbnails((prev) => ({ ...prev, [assetId]: mapped }));
    } catch (_) {
    } finally {
      thumbnailsLoadingRef.current[assetId] = false;
      setThumbnailsLoading((prev) => ({ ...prev, [assetId]: false }));
    }
  }, [thumbnails]);

  // Fetch thumbnails for video clips whenever timeline changes
  useEffect(() => {
    for (const track of timeline.tracks) {
      if (track.kind !== "Video") continue;
      for (const item of track.items) {
        const data = getItemData(item);
        if (data.variant === "VideoClip" && data.asset_id) {
          fetchThumbnails(data.asset_id);
        }
      }
    }
  }, [timeline]);

  // Fetch waveforms for audio clips whenever timeline changes
  useEffect(() => {
    for (const track of timeline.tracks) {
      if (track.kind !== "Audio") continue;
      for (const item of track.items) {
        const data = getItemData(item);
        if (data.variant === "AudioClip" && data.asset_id) {
          fetchWaveform(data.asset_id);
        }
      }
    }
  }, [timeline]);

  const usToPixels = (us: number) => (us / 1_000_000) * pixelsPerSecond;
  const pixelsToUs = (px: number) => (px / pixelsPerSecond) * 1_000_000;

  const totalWidth = () => {
    let maxEnd = 30_000_000;
    for (const track of timeline.tracks) {
      for (const item of track.items) {
        const data = getItemData(item);
        const end = data.startUs + data.durationUs;
        if (end > maxEnd) maxEnd = end;
      }
    }
    return usToPixels(maxEnd + 5_000_000) + LABEL_W;
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -10 : 10;
      setPixelsPerSecond(p => Math.max(10, Math.min(500, p + delta)));
    }
  };

  const scrollToPlayhead = () => {
    if (!timelineRef.current) return;
    const playheadPx = usToPixels(props.playheadUs) + LABEL_W;
    const vw = timelineRef.current.clientWidth;
    timelineRef.current.scrollLeft = playheadPx - vw / 2;
  };

  const fitAll = () => {
    if (!timelineRef.current) return;
    let maxEnd = 5_000_000;
    for (const track of timeline.tracks) {
      for (const item of track.items) {
        const data = getItemData(item);
        const end = data.startUs + data.durationUs;
        if (end > maxEnd) maxEnd = end;
      }
    }
    const vw = timelineRef.current.clientWidth - LABEL_W;
    const needed = maxEnd / 1_000_000;
    setPixelsPerSecond(Math.max(10, Math.min(500, vw / needed)));
  };

  // Auto-scroll to playhead on zoom change
  useEffect(() => {
    if (!timelineRef.current) return;
    const playheadPx = usToPixels(props.playheadUs) + LABEL_W;
    const vw = timelineRef.current.clientWidth;
    const currentScroll = timelineRef.current.scrollLeft;
    // Only scroll if playhead is outside visible area
    if (playheadPx < currentScroll || playheadPx > currentScroll + vw) {
      timelineRef.current.scrollLeft = playheadPx - vw / 2;
    }
  }, [pixelsPerSecond]);

  // Init default tracks on mount
  useEffect(() => {
    (async () => {
      const tl = await invoke<TimelineData>("init_default_tracks");
      setTimeline(tl);
    })();
  }, []);

  const calcPlayheadFromMouse = (e: MouseEvent | React.MouseEvent): number => {
    if (!timelineRef.current) return 0;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollLeft - LABEL_W;
    return Math.max(0, Math.round(pixelsToUs(x)));
  };

  // --- Global event handlers via refs to avoid stale closures ---

  // Keyboard shortcuts
  const handleKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});
  handleKeyDownRef.current = async (e: KeyboardEvent) => {
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

    // Zoom shortcuts
    if ((e.key === "=" || e.key === "+") && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setPixelsPerSecond(p => Math.min(500, p + 20));
      return;
    }
    if (e.key === "-" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setPixelsPerSecond(p => Math.max(10, p - 20));
      return;
    }
    if (e.key === "0" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      fitAll();
      return;
    }

    const sel = selectedClipId;
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => handleKeyDownRef.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Global mouse up for drag and trim
  const handleGlobalMouseUpRef = useRef<(e: MouseEvent) => void>(() => {});
  handleGlobalMouseUpRef.current = async (e: MouseEvent) => {
    const ds = dragState;
    const ts = trimState;

    if (ds) {
      const dx = e.clientX - ds.startMouseX;
      const deltaUs = pixelsToUs(dx);
      let newStartUs = Math.max(0, Math.round(ds.originalStartUs + deltaUs));
      const targetTrack = getTrackAtY(e.clientY);
      setDragState(null);
      setSnapLineUs(null);
      setDragTargetTrackId(null);
      if (Math.abs(dx) < 3 && Math.abs(e.clientY - ds.startMouseY) < 3) return;

      if (snapping) {
        try {
          const snapPoints = await invoke<number[]>("get_snap_points", {
            excludeItemId: ds.itemId,
          });
          const thresholdUs = Math.round(pixelsToUs(5));
          let bestDist = thresholdUs + 1;
          let bestPoint = newStartUs;
          for (const point of snapPoints) {
            const dist = Math.abs(newStartUs - point);
            if (dist < bestDist) {
              bestDist = dist;
              bestPoint = point;
            }
          }
          if (bestDist <= thresholdUs) {
            newStartUs = bestPoint;
          }
        } catch (_) {}
      }

      // Cross-track move if target is a different track of the same kind
      if (targetTrack && targetTrack.id !== ds.trackId && targetTrack.kind === ds.trackKind) {
        try {
          const tl = await invoke<TimelineData>("move_clip_to_track", {
            itemId: ds.itemId,
            newTrackId: targetTrack.id,
            newStartUs,
          });
          setTimeline(tl);
        } catch (err) {
          console.error("move_clip_to_track failed:", err);
        }
      } else {
        try {
          const tl = await invoke<TimelineData>("move_clip", {
            itemId: ds.itemId,
            newStartUs,
          });
          setTimeline(tl);
        } catch (err) {
          console.error("move_clip failed:", err);
        }
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

  // Global mouse move for snap-line preview
  const handleGlobalMouseMoveRef = useRef<(e: MouseEvent) => void>(() => {});
  handleGlobalMouseMoveRef.current = (e: MouseEvent) => {
    const ds = dragState;
    if (!ds) {
      if (snapLineUs !== null) setSnapLineUs(null);
      if (dragTargetTrackId !== null) setDragTargetTrackId(null);
      return;
    }

    // Detect target track for cross-track drag highlight
    const targetTrack = getTrackAtY(e.clientY);
    if (targetTrack && targetTrack.id !== ds.trackId && targetTrack.kind === ds.trackKind) {
      setDragTargetTrackId(targetTrack.id);
    } else {
      setDragTargetTrackId(null);
    }

    if (!snapping) {
      if (snapLineUs !== null) setSnapLineUs(null);
      return;
    }

    const dx = e.clientX - ds.startMouseX;
    const deltaUs = pixelsToUs(dx);
    const pos = Math.max(0, Math.round(ds.originalStartUs + deltaUs));

    if (!snapPointsCacheRef.current) {
      invoke<number[]>("get_snap_points", { excludeItemId: ds.itemId })
        .then((pts) => { snapPointsCacheRef.current = pts; })
        .catch(() => {});
      return;
    }

    const thresholdUs = Math.round(pixelsToUs(5));
    let bestDist = thresholdUs + 1;
    let bestPoint: number | null = null;
    for (const point of snapPointsCacheRef.current) {
      const dist = Math.abs(pos - point);
      if (dist < bestDist) {
        bestDist = dist;
        bestPoint = point;
      }
    }
    setSnapLineUs(bestDist <= thresholdUs ? bestPoint : null);
  };

  useEffect(() => {
    const upHandler = (e: MouseEvent) => handleGlobalMouseUpRef.current(e);
    const moveHandler = (e: MouseEvent) => handleGlobalMouseMoveRef.current(e);
    window.addEventListener("mouseup", upHandler);
    window.addEventListener("mousemove", moveHandler);
    return () => {
      window.removeEventListener("mouseup", upHandler);
      window.removeEventListener("mousemove", moveHandler);
    };
  }, []);

  // Ruler scrub handlers
  const handleRulerMouseMoveRef = useRef<(e: MouseEvent) => void>(() => {});
  handleRulerMouseMoveRef.current = (e: MouseEvent) => {
    if (!rulerDraggingRef.current) return;
    if (props.playing) props.onPlayingChange(false);
    props.onPlayheadChange(calcPlayheadFromMouse(e));
  };

  const handleRulerMouseUpRef = useRef<() => void>(() => {});
  handleRulerMouseUpRef.current = () => {
    rulerDraggingRef.current = false;
  };

  useEffect(() => {
    const moveHandler = (e: MouseEvent) => handleRulerMouseMoveRef.current(e);
    const upHandler = () => handleRulerMouseUpRef.current();
    window.addEventListener("mousemove", moveHandler);
    window.addEventListener("mouseup", upHandler);
    return () => {
      window.removeEventListener("mousemove", moveHandler);
      window.removeEventListener("mouseup", upHandler);
    };
  }, []);

  const handleRulerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    rulerDraggingRef.current = true;
    if (props.playing) props.onPlayingChange(false);
    props.onPlayheadChange(calcPlayheadFromMouse(e));
  };

  const handleDrop = async (e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    const assetJson = e.dataTransfer?.getData("application/forgecut-asset");
    if (!assetJson) return;
    const asset = JSON.parse(assetJson);

    const trackContent = (e.currentTarget as HTMLElement).querySelector(".track-content") as HTMLElement;
    const rect = trackContent.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const startUs = Math.max(0, Math.round(pixelsToUs(x)));

    const tl = await invoke<TimelineData>("add_clip_to_timeline", {
      assetId: asset.id,
      trackId: trackId,
      timelineStartUs: startUs,
    });
    setTimeline(tl);
  };

  const getTrackAtY = (clientY: number): { id: string; kind: string } | null => {
    const lanes = document.querySelectorAll(".track-lane");
    for (const lane of lanes) {
      const rect = lane.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        const trackIndex = Array.from(lanes).indexOf(lane);
        const track = timeline.tracks[trackIndex];
        if (track) return { id: track.id, kind: track.kind };
      }
    }
    return null;
  };

  const handleClipMouseDown = (e: React.MouseEvent, itemId: string, startUs: number, trackId: string, trackKind: string) => {
    if ((e.target as HTMLElement).classList.contains("trim-handle")) return;
    e.stopPropagation();
    setSelectedClipId(itemId);
    snapPointsCacheRef.current = null;
    setDragState({ itemId, startMouseX: e.clientX, startMouseY: e.clientY, originalStartUs: startUs, trackId, trackKind });
  };

  const handleTrimMouseDown = (
    e: React.MouseEvent,
    itemId: string,
    edge: "left" | "right",
    currentUs: number
  ) => {
    e.stopPropagation();
    setSelectedClipId(itemId);
    setTrimState({ itemId, edge, startMouseX: e.clientX, originalUs: currentUs });
  };

  const trackColor = (kind: string, isPip?: boolean) => {
    if (isPip) return "#9b59b6";
    switch (kind) {
      case "Video": return "#4a9eff";
      case "Audio": return "#4aff7f";
      case "OverlayImage": return "#c840e9";
      case "OverlayText": return "#e9a840";
      default: return "#ff9f4a";
    }
  };

  const isPipTrack = (track: Track, tracks: Track[]) => {
    if (track.kind !== "Video") return false;
    const firstVideoIndex = tracks.findIndex((t) => t.kind === "Video");
    return tracks.indexOf(track) !== firstVideoIndex;
  };

  const handleAddPipTrack = async () => {
    try {
      const tl = await invoke<TimelineData>("add_track", { kind: "Video" });
      setTimeline(tl);
    } catch (err) {
      console.error("add_track failed:", err);
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
    const interval = pixelsPerSecond >= 80 ? 1 : pixelsPerSecond >= 40 ? 2 : 5;
    const ticks = [];
    for (let sec = 0; sec * pixelsPerSecond + LABEL_W < width; sec += interval) {
      ticks.push(sec);
    }
    return ticks;
  };

  return (
    <section className="panel timeline">
      <div className="timeline-controls">
        <span className="timeline-label">Timeline</span>
        <div className="control-group">
          <button className="add-text-btn" onClick={handleAddText}>+ Text</button>
          <button className="add-text-btn" onClick={handleAddPipTrack}>+ PiP</button>
        </div>
        <div className="control-group">
          <button className="timeline-nav-btn" onClick={scrollToPlayhead} title="Scroll to playhead">Playhead</button>
          <button className="timeline-nav-btn" onClick={fitAll} title="Fit all">Fit</button>
        </div>
        <div className="control-group">
          <button
            className={`snap-toggle-btn${snapping ? " snap-active" : ""}`}
            onClick={() => setSnapping((s) => !s)}
            title={snapping ? "Snapping on" : "Snapping off"}
          >Snap</button>
        </div>
        <div className="control-group zoom-control">
          <button onClick={() => setPixelsPerSecond((p) => Math.max(10, p - 20))}>-</button>
          <input
            type="range"
            className="zoom-slider"
            min={10}
            max={500}
            value={pixelsPerSecond}
            onChange={(e) => setPixelsPerSecond(Number(e.target.value))}
          />
          <button onClick={() => setPixelsPerSecond((p) => Math.min(500, p + 20))}>+</button>
          <span className="zoom-label">{Math.round(pixelsPerSecond)}%</span>
        </div>
        <span className="shortcut-hints">S: Split | Del: Delete | Ctrl+Z/Y: Undo/Redo</span>
      </div>

      <div className="timeline-minimap">
        <div className="minimap-viewport" style={{
          left: `${(scrollLeft / totalWidth()) * 100}%`,
          width: `${(viewWidth / totalWidth()) * 100}%`,
        }} />
      </div>

      <div
        className="timeline-scroll"
        ref={timelineRef}
        onWheel={handleWheel}
        onScroll={(e) => {
          setScrollLeft(e.currentTarget.scrollLeft);
          setViewWidth(e.currentTarget.clientWidth);
        }}
        onMouseDown={(e) => {
          setSelectedClipId(null);
          // Seek playhead when clicking empty track area
          if ((e.target as HTMLElement).classList.contains("track-content")) {
            if (props.playing) props.onPlayingChange(false);
            props.onPlayheadChange(calcPlayheadFromMouse(e));
          }
        }}
      >
        <div className="timeline-content" style={{ width: `${totalWidth()}px` }}>
          <div className="time-ruler" onMouseDown={handleRulerMouseDown}>
            {renderRuler().map((sec) => (
              <div key={sec} className="ruler-tick" style={{ left: `${sec * pixelsPerSecond + LABEL_W}px` }}>
                <span className="ruler-label">{formatTimecode(sec)}</span>
              </div>
            ))}
          </div>

          <div className="playhead" style={{ left: `${usToPixels(props.playheadUs) + LABEL_W}px` }} />

          {snapLineUs !== null && (
            <div className="snap-line" style={{ left: `${usToPixels(snapLineUs!) + LABEL_W}px` }} />
          )}

          <div className="track-lanes">
            {timeline.tracks.map((track, trackIndex) => {
              const pip = isPipTrack(track, timeline.tracks);
              return (
                <div
                  key={track.id}
                  className={`track-lane${pip ? " track-lane-pip" : ""}${dragTargetTrackId === track.id ? " track-lane-drop-target" : ""}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDrop(e, track.id)}
                >
                  <div className="track-label">
                    {pip ? "PiP" : track.kind === "Video" ? "V" : track.kind === "Audio" ? "A" : track.kind === "OverlayImage" ? "Img" : track.kind === "OverlayText" ? "T" : "?"}
                    {trackIndex + 1}
                  </div>
                  <div className="track-content">
                    {track.items.map((item) => {
                      const data = getItemData(item);
                      const isSelected = selectedClipId === data.id;
                      return (
                        <div
                          key={data.id}
                          className={`clip${isSelected ? " clip-selected" : ""}${data.variant === "VideoClip" && thumbnailsLoading[data.asset_id] && !thumbnails[data.asset_id] ? " clip-loading-thumbs" : ""}`}
                          style={{
                            left: `${usToPixels(data.startUs)}px`,
                            width: `${Math.max(4, usToPixels(data.durationUs))}px`,
                            backgroundColor: trackColor(track.kind, pip),
                          }}
                          onMouseDown={(e) => handleClipMouseDown(e, data.id, data.startUs, track.id, track.kind)}
                        >
                          <div
                            className="trim-handle trim-handle-left"
                            onMouseDown={(e) =>
                              handleTrimMouseDown(
                                e, data.id, "left",
                                data.variant === "VideoClip" || data.variant === "AudioClip"
                                  ? data.source_in_us : data.startUs
                              )
                            }
                          />
                          {data.variant === "VideoClip" && thumbnails[data.asset_id] && (
                            <div className="clip-thumbnails">
                              {thumbnails[data.asset_id]
                                .filter((t) => {
                                  const tUs = t.time_seconds * 1_000_000;
                                  return tUs >= (data.source_in_us || 0) && tUs < (data.source_out_us || Infinity);
                                })
                                .map((t) => (
                                  <img
                                    key={t.time_seconds}
                                    className="clip-thumbnail"
                                    src={t.url}
                                    style={{
                                      left: `${usToPixels((t.time_seconds * 1_000_000) - (data.source_in_us || 0))}px`,
                                    }}
                                    draggable={false}
                                  />
                                ))}
                            </div>
                          )}
                          <span className="clip-label">
                            {data.variant === "AudioClip" ? "Audio" : data.variant === "VideoClip" ? "Video" : data.variant === "ImageOverlay" ? "Image" : data.variant === "TextOverlay" ? data.text || "Text" : data.variant}
                          </span>
                          {data.variant === "AudioClip" && waveforms[data.asset_id] && (
                            <svg
                              className="waveform-svg"
                              viewBox={`0 0 ${waveforms[data.asset_id]!.length} 100`}
                              preserveAspectRatio="none"
                              style={{
                                position: "absolute",
                                left: "6px",
                                right: "6px",
                                top: "0",
                                bottom: "0",
                                width: "calc(100% - 12px)",
                                height: "100%",
                                opacity: "0.5",
                                pointerEvents: "none",
                              }}
                            >
                              {waveforms[data.asset_id]!.map((peak, i) => (
                                <line
                                  key={i}
                                  x1={i}
                                  x2={i}
                                  y1={50 - (peak as unknown as [number, number])[1] * 50}
                                  y2={50 - (peak as unknown as [number, number])[0] * 50}
                                  stroke="white"
                                  strokeWidth="1"
                                />
                              ))}
                            </svg>
                          )}
                          <div
                            className="trim-handle trim-handle-right"
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
                    })}
                  </div>
                </div>
              );
            })}
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
