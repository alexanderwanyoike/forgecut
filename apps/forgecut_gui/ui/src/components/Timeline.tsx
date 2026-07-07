import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "../lib/bridge";
import {
  LABEL_W,
  TIMELINE_ZOOM_MAX,
  TIMELINE_ZOOM_MIN,
  clampZoom,
  formatTimecode,
  minimapViewport,
  timelineRulerInterval,
  usToPixels,
  zoomInLevel,
  zoomOutLevel,
} from "../lib/timeline/geometry";
import {
  getItemData,
  timelineContentWidth,
  timelineMaxEndUs,
  type Timeline as TimelineData,
  type Track,
} from "../lib/timeline/items";
import { useClipMedia } from "../hooks/useClipMedia";
import { useTimelineInteractions } from "../hooks/useTimelineInteractions";
import { useTimelineShortcuts } from "../hooks/useTimelineShortcuts";
import TimelineClip from "./TimelineClip";

interface TimelineProps {
  playheadUs: number;
  playing: boolean;
  onPlayheadChange: (us: number) => void;
  onPlayingChange: (playing: boolean) => void;
  selectedClipId: string | null;
  onSelectedClipChange: (id: string | null) => void;
  projectVersion: number;
}

export default function Timeline(props: TimelineProps) {
  const [timeline, setTimeline] = useState<TimelineData>({ tracks: [], markers: [] });
  const [pixelsPerSecond, setPixelsPerSecond] = useState(100);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewWidth, setViewWidth] = useState(0);
  const [snapping, setSnapping] = useState(true);

  const timelineRef = useRef<HTMLDivElement>(null);

  const { waveforms, thumbnails, thumbnailsLoading } = useClipMedia(
    timeline,
    props.projectVersion,
  );

  const {
    dragTargetTrackId,
    snapLineUs,
    handleRulerMouseDown,
    handleClipMouseDown,
    handleTrimMouseDown,
  } = useTimelineInteractions({
    timelineRef,
    pixelsPerSecond,
    snapping,
    timeline,
    setTimeline,
    playing: props.playing,
    onPlayingChange: props.onPlayingChange,
    onPlayheadChange: props.onPlayheadChange,
    onSelectClip: props.onSelectedClipChange,
  });

  const fitAll = useCallback(() => {
    if (!timelineRef.current) return;
    const maxEnd = timelineMaxEndUs(timeline, 5_000_000);
    const vw = timelineRef.current.clientWidth - LABEL_W;
    setPixelsPerSecond(clampZoom(vw / (maxEnd / 1_000_000)));
  }, [timeline]);

  useTimelineShortcuts({
    selectedClipId: props.selectedClipId,
    playheadUs: props.playheadUs,
    setTimeline,
    onSelectClip: props.onSelectedClipChange,
    zoomIn: () => setPixelsPerSecond(zoomInLevel),
    zoomOut: () => setPixelsPerSecond(zoomOutLevel),
    fitAll,
  });

  const updateViewportMetrics = useCallback(() => {
    if (!timelineRef.current) return;
    setScrollLeft(timelineRef.current.scrollLeft);
    setViewWidth(timelineRef.current.clientWidth);
  }, []);

  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;

    updateViewportMetrics();
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateViewportMetrics) : null;
    resizeObserver?.observe(el);
    window.addEventListener("resize", updateViewportMetrics);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateViewportMetrics);
    };
  }, [updateViewportMetrics]);

  // Init default tracks on mount and after project load
  useEffect(() => {
    (async () => {
      setTimeline(await invoke("init_default_tracks"));
    })();
  }, [props.projectVersion]);

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setPixelsPerSecond((p) => (e.deltaY > 0 ? zoomOutLevel(p) : zoomInLevel(p)));
    }
  };

  const scrollToPlayhead = () => {
    if (!timelineRef.current) return;
    const playheadPx = usToPixels(props.playheadUs, pixelsPerSecond) + LABEL_W;
    const vw = timelineRef.current.clientWidth;
    timelineRef.current.scrollLeft = playheadPx - vw / 2;
  };

  // Auto-scroll to playhead on zoom change if it left the visible area
  useEffect(() => {
    if (!timelineRef.current) return;
    const playheadPx = usToPixels(props.playheadUs, pixelsPerSecond) + LABEL_W;
    const vw = timelineRef.current.clientWidth;
    const currentScroll = timelineRef.current.scrollLeft;
    if (playheadPx < currentScroll || playheadPx > currentScroll + vw) {
      timelineRef.current.scrollLeft = playheadPx - vw / 2;
    }
  }, [pixelsPerSecond]);

  const handleDrop = async (e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    const assetJson = e.dataTransfer?.getData("application/forgecut-asset");
    if (!assetJson) return;
    const asset = JSON.parse(assetJson);

    const trackContent = (e.currentTarget as HTMLElement).querySelector(".track-content") as HTMLElement;
    const rect = trackContent.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const startUs = Math.max(0, Math.round((x / pixelsPerSecond) * 1_000_000));

    const tl = await invoke("add_clip_to_timeline", {
      assetId: asset.id,
      trackId: trackId,
      timelineStartUs: startUs,
    });
    setTimeline(tl);
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

  const trackLabel = (track: Track, pip: boolean) => {
    if (pip) return "PiP";
    switch (track.kind) {
      case "Video": return "V";
      case "Audio": return "A";
      case "OverlayImage": return "Img";
      case "OverlayText": return "T";
      default: return "?";
    }
  };

  const handleAddPipTrack = async () => {
    try {
      setTimeline(await invoke("add_track", { kind: "Video" }));
    } catch (err) {
      console.error("add_track failed:", err);
    }
  };

  const handleAddText = async () => {
    try {
      const tl = await invoke("add_text_overlay", {
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

  const timelineWidth = timelineContentWidth(timeline, pixelsPerSecond);
  const rulerInterval = timelineRulerInterval(pixelsPerSecond);
  const rulerTicks = [];
  for (let sec = 0; sec * pixelsPerSecond + LABEL_W < timelineWidth; sec += rulerInterval) {
    rulerTicks.push(sec);
  }

  const { leftPercent: minimapLeft, widthPercent: minimapWidth } = minimapViewport(
    viewWidth,
    timelineWidth,
    scrollLeft,
  );

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
          <button onClick={() => setPixelsPerSecond(zoomOutLevel)}>-</button>
          <input
            type="range"
            className="zoom-slider"
            min={TIMELINE_ZOOM_MIN}
            max={TIMELINE_ZOOM_MAX}
            value={pixelsPerSecond}
            onChange={(e) => setPixelsPerSecond(clampZoom(Number(e.target.value)))}
          />
          <button onClick={() => setPixelsPerSecond(zoomInLevel)}>+</button>
          <span className="zoom-label">{Math.round(pixelsPerSecond)}%</span>
        </div>
        <span className="shortcut-hints">S: Split | Del: Delete | Ctrl+Z/Y: Undo/Redo</span>
      </div>

      <div className="timeline-minimap">
        <div className="minimap-viewport" style={{
          left: `${minimapLeft}%`,
          width: `${minimapWidth}%`,
        }} />
      </div>

      <div
        className="timeline-scroll"
        ref={timelineRef}
        onWheel={handleWheel}
        onScroll={updateViewportMetrics}
        onMouseDown={() => props.onSelectedClipChange(null)}
      >
        <div className="timeline-content" style={{ width: `${timelineWidth}px` }}>
          <div className="time-ruler" onMouseDown={handleRulerMouseDown}>
            {rulerTicks.map((sec) => (
              <div key={sec} className="ruler-tick" style={{ left: `${sec * pixelsPerSecond + LABEL_W}px` }}>
                <span className="ruler-label">{formatTimecode(sec)}</span>
              </div>
            ))}
          </div>

          <div className="playhead" style={{ left: `${usToPixels(props.playheadUs, pixelsPerSecond) + LABEL_W}px` }} />

          {snapLineUs !== null && (
            <div className="snap-line" style={{ left: `${usToPixels(snapLineUs, pixelsPerSecond) + LABEL_W}px` }} />
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
                    {trackLabel(track, pip)}
                    {trackIndex + 1}
                  </div>
                  <div className="track-content">
                    {track.items.map((item) => {
                      const data = getItemData(item);
                      return (
                        <TimelineClip
                          key={data.id}
                          data={data}
                          color={trackColor(track.kind, pip)}
                          selected={props.selectedClipId === data.id}
                          pixelsPerSecond={pixelsPerSecond}
                          thumbnails={data.asset_id ? thumbnails[data.asset_id] : undefined}
                          thumbnailsLoading={data.asset_id ? !!thumbnailsLoading[data.asset_id] : false}
                          waveform={data.asset_id ? waveforms[data.asset_id] : undefined}
                          onClipMouseDown={(e) =>
                            handleClipMouseDown(e, data.id, data.startUs, track.id, track.kind)
                          }
                          onTrimMouseDown={(e, edge, currentUs) =>
                            handleTrimMouseDown(e, data.id, edge, currentUs)
                          }
                        />
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
