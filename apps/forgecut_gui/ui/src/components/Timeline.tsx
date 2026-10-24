import {
  Layers3,
  Magnet,
  Maximize2,
  Minus,
  Plus,
  ScanLine,
  Type,
} from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import ActionButton from "./ActionButton";
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
import { graphicPresets } from "../../electron/domain/graphic-presets";
import TimelineClip from "./TimelineClip";

interface TimelineProps {
  playheadUs: number;
  playing: boolean;
  onPlayheadChange: (us: number) => void;
  onPlayingChange: (playing: boolean) => void;
  selectedClipId: string | null;
  onSelectedClipChange: (id: string | null) => void;
  projectVersion: number;
  projectTimeline?: TimelineData;
  projectMediaVersion?: string;
}

export default function Timeline(props: TimelineProps) {
  const [localTimeline, setLocalTimeline] = useState<TimelineData>({
    tracks: [],
    markers: [],
  });
  const timeline = props.projectTimeline ?? localTimeline;
  const setTimeline = useCallback(
    (next: TimelineData) => {
      if (!props.projectTimeline) setLocalTimeline(next);
    },
    [props.projectTimeline],
  );
  const [pixelsPerSecond, setPixelsPerSecond] = useState(100);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewWidth, setViewWidth] = useState(0);
  const [graphicPreset, setGraphicPreset] = useState("title-card");
  const [newTrackKind, setNewTrackKind] = useState<"Video" | "Audio">("Video");
  const [snapping, setSnapping] = useState(true);

  const timelineRef = useRef<HTMLDivElement>(null);

  const { waveforms, thumbnails, thumbnailsLoading } = useClipMedia(
    timeline,
    props.projectMediaVersion ?? props.projectVersion,
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
    projectVersion: props.projectVersion,
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
    if (!el) return undefined;

    updateViewportMetrics();
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateViewportMetrics)
        : null;
    resizeObserver?.observe(el);
    window.addEventListener("resize", updateViewportMetrics);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateViewportMetrics);
    };
  }, [updateViewportMetrics]);

  // Init default tracks on mount and after project load
  useEffect(() => {
    if (props.projectTimeline) return undefined;
    let cancelled = false;
    (async () => {
      const next = await invoke("init_default_tracks");
      if (!cancelled) setTimeline(next);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [props.projectVersion, props.projectTimeline, setTimeline]);

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setPixelsPerSecond((p) =>
        e.deltaY > 0 ? zoomOutLevel(p) : zoomInLevel(p),
      );
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
    const asset: unknown = JSON.parse(assetJson);
    if (
      !asset ||
      typeof asset !== "object" ||
      !("id" in asset) ||
      typeof asset.id !== "string"
    )
      return;

    const trackContent = (e.currentTarget as HTMLElement).querySelector(
      ".track-content",
    ) as HTMLElement;
    const rect = trackContent.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const startUs = Math.max(0, Math.round((x / pixelsPerSecond) * 1_000_000));

    const tl = await invoke("add_clip_to_timeline", {
      assetId: asset.id,
      trackId,
      timelineStartUs: startUs,
    });
    setTimeline(tl);
  };

  const trackColor = (kind: string, isPip?: boolean) => {
    if (isPip) return "var(--clip-video)";
    switch (kind) {
      case "Video":
        return "var(--clip-video)";
      case "Audio":
        return "var(--clip-audio)";
      case "OverlayImage":
        return "var(--clip-image)";
      case "OverlayText":
        return "var(--clip-text)";
      case "Graphics":
        return "var(--clip-graphic)";
      default:
        return "var(--clip-video)";
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
      case "Video":
        return "V";
      case "Audio":
        return "A";
      case "OverlayImage":
        return "Img";
      case "OverlayText":
        return "T";
      case "Graphics":
        return "G";
      default:
        return "?";
    }
  };

  const handleAddTrack = async () => {
    try {
      setTimeline(await invoke("add_track", { kind: newTrackKind }));
    } catch (err) {
      console.error("add_track failed:", err);
    }
  };

  const handleAddText = async () => {
    try {
      const tl = await invoke("add_text_overlay", {
        trackId:
          timeline.tracks.find((track) => track.kind === "OverlayText")?.id ??
          crypto.randomUUID(),
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

  const handleAddGraphic = async () => {
    try {
      setTimeline(
        await invoke("add_graphic_item", {
          templateId: graphicPreset,
          trackId:
            timeline.tracks.find((track) => track.kind === "Graphics")?.id ??
            crypto.randomUUID(),
          timelineStartUs: props.playheadUs,
          durationUs: 3000000,
        }),
      );
    } catch (failure) {
      console.error("Creating graphic failed", failure);
    }
  };

  const timelineWidth = timelineContentWidth(timeline, pixelsPerSecond);
  const rulerInterval = timelineRulerInterval(pixelsPerSecond);
  const rulerTicks = [];
  for (
    let sec = 0;
    sec * pixelsPerSecond + LABEL_W < timelineWidth;
    sec += rulerInterval
  ) {
    rulerTicks.push(sec);
  }

  const { leftPercent: minimapLeft, widthPercent: minimapWidth } =
    minimapViewport(viewWidth, timelineWidth, scrollLeft);

  return (
    <section className="panel timeline">
      <div className="timeline-controls">
        <span className="timeline-label">
          <Layers3 size={15} aria-hidden="true" />
          Timeline
        </span>
        <div className="control-group">
          <select
            aria-label="Graphic template"
            value={graphicPreset}
            onChange={(event) => setGraphicPreset(event.currentTarget.value)}
          >
            {graphicPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
          <ActionButton
            icon={Plus}
            aria-label="Add graphic"
            tooltip="Add graphic at the playhead"
            onClick={handleAddGraphic}
          >
            Graphic
          </ActionButton>
          <ActionButton
            icon={Type}
            aria-label="Add text"
            tooltip="Add text at the playhead"
            onClick={handleAddText}
          >
            Text
          </ActionButton>
        </div>
        <div className="control-group">
          <select
            aria-label="New track type"
            value={newTrackKind}
            onChange={(event) =>
              setNewTrackKind(
                event.currentTarget.value === "Audio" ? "Audio" : "Video",
              )
            }
          >
            <option value="Video">Video</option>
            <option value="Audio">Audio</option>
          </select>
          <ActionButton
            icon={Plus}
            aria-label="Add track"
            tooltip="Add a track of the selected type"
            onClick={handleAddTrack}
          >
            Track
          </ActionButton>
        </div>
        <div className="control-group">
          <ActionButton
            icon={ScanLine}
            tooltip="Scroll to playhead"
            onClick={scrollToPlayhead}
          >
            Playhead
          </ActionButton>
          <ActionButton
            icon={Maximize2}
            tooltip="Fit the entire sequence (Ctrl+0)"
            onClick={fitAll}
          >
            Fit
          </ActionButton>
          <ActionButton
            icon={Magnet}
            aria-pressed={snapping}
            tooltip={snapping ? "Snapping on" : "Snapping off"}
            onClick={() => setSnapping((s) => !s)}
          >
            Snap
          </ActionButton>
        </div>
        <div className="control-group zoom-control">
          <ActionButton
            icon={Minus}
            iconOnly
            tooltip="Zoom out"
            onClick={() => setPixelsPerSecond(zoomOutLevel)}
          />
          <input
            type="range"
            className="zoom-slider"
            aria-label="Timeline zoom"
            min={TIMELINE_ZOOM_MIN}
            max={TIMELINE_ZOOM_MAX}
            value={pixelsPerSecond}
            onChange={(e) =>
              setPixelsPerSecond(clampZoom(Number(e.target.value)))
            }
          />
          <ActionButton
            icon={Plus}
            iconOnly
            tooltip="Zoom in"
            onClick={() => setPixelsPerSecond(zoomInLevel)}
          />
          <span className="zoom-label">{Math.round(pixelsPerSecond)}%</span>
        </div>
      </div>

      <div className="timeline-minimap">
        <div
          className="minimap-viewport"
          style={{
            left: `${minimapLeft}%`,
            width: `${minimapWidth}%`,
          }}
        />
      </div>

      <div
        className="timeline-scroll"
        ref={timelineRef}
        onWheel={handleWheel}
        onScroll={updateViewportMetrics}
        onMouseDown={() => props.onSelectedClipChange(null)}
      >
        <div
          className="timeline-content"
          style={{ width: `${timelineWidth}px` }}
        >
          <div className="time-ruler" onMouseDown={handleRulerMouseDown}>
            {rulerTicks.map((sec) => (
              <div
                key={sec}
                className="ruler-tick"
                style={{ left: `${sec * pixelsPerSecond + LABEL_W}px` }}
              >
                <span className="ruler-label">{formatTimecode(sec)}</span>
              </div>
            ))}
          </div>

          <div
            className="playhead"
            style={{
              left: `${usToPixels(props.playheadUs, pixelsPerSecond) + LABEL_W}px`,
            }}
          />

          {timeline.duration_us !== undefined && (
            <div
              className="sequence-end"
              title="Sequence end"
              style={{
                left: `${usToPixels(timeline.duration_us, pixelsPerSecond) + LABEL_W}px`,
              }}
            >
              <span>End</span>
            </div>
          )}
          {snapLineUs !== null && (
            <div
              className="snap-line"
              style={{
                left: `${usToPixels(snapLineUs, pixelsPerSecond) + LABEL_W}px`,
              }}
            />
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
                          thumbnails={
                            data.asset_id
                              ? thumbnails[data.asset_id]
                              : undefined
                          }
                          thumbnailsLoading={
                            data.asset_id
                              ? !!thumbnailsLoading[data.asset_id]
                              : false
                          }
                          waveform={
                            data.asset_id ? waveforms[data.asset_id] : undefined
                          }
                          onClipMouseDown={(e) =>
                            handleClipMouseDown(
                              e,
                              data.id,
                              data.startUs,
                              track.id,
                              track.kind,
                            )
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
