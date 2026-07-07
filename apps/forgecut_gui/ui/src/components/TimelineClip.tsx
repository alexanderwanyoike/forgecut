import { usToPixels } from "../lib/timeline/geometry";
import type { ItemView } from "../lib/timeline/items";
import type { ThumbnailView } from "../hooks/useClipMedia";

interface TimelineClipProps {
  data: ItemView;
  color: string;
  selected: boolean;
  pixelsPerSecond: number;
  thumbnails?: ThumbnailView[];
  thumbnailsLoading: boolean;
  waveform?: number[][];
  onClipMouseDown: (e: React.MouseEvent) => void;
  onTrimMouseDown: (e: React.MouseEvent, edge: "left" | "right", currentUs: number) => void;
}

function clipLabel(data: ItemView): string {
  switch (data.variant) {
    case "AudioClip": return "Audio";
    case "VideoClip": return "Video";
    case "ImageOverlay": return "Image";
    case "TextOverlay": return data.text || "Text";
    default: return data.variant;
  }
}

export default function TimelineClip({
  data,
  color,
  selected,
  pixelsPerSecond,
  thumbnails,
  thumbnailsLoading,
  waveform,
  onClipMouseDown,
  onTrimMouseDown,
}: TimelineClipProps) {
  const isSourceClip = data.variant === "VideoClip" || data.variant === "AudioClip";
  const trimLeftUs = isSourceClip ? data.source_in_us! : data.startUs;
  const trimRightUs = isSourceClip ? data.source_out_us! : data.startUs + data.durationUs;
  const showThumbnailShimmer =
    data.variant === "VideoClip" && thumbnailsLoading && !thumbnails;

  return (
    <div
      className={`clip${selected ? " clip-selected" : ""}${showThumbnailShimmer ? " clip-loading-thumbs" : ""}`}
      style={{
        left: `${usToPixels(data.startUs, pixelsPerSecond)}px`,
        width: `${Math.max(4, usToPixels(data.durationUs, pixelsPerSecond))}px`,
        backgroundColor: color,
      }}
      onMouseDown={onClipMouseDown}
    >
      <div
        className="trim-handle trim-handle-left"
        onMouseDown={(e) => onTrimMouseDown(e, "left", trimLeftUs)}
      />
      {data.variant === "VideoClip" && thumbnails && (
        <div className="clip-thumbnails">
          {thumbnails
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
                  left: `${usToPixels((t.time_seconds * 1_000_000) - (data.source_in_us || 0), pixelsPerSecond)}px`,
                }}
                draggable={false}
              />
            ))}
        </div>
      )}
      <span className="clip-label">{clipLabel(data)}</span>
      {data.variant === "AudioClip" && waveform && (
        <svg
          className="waveform-svg"
          viewBox={`0 0 ${waveform.length} 100`}
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
          {waveform.map((peak, i) => (
            <line
              key={i}
              x1={i}
              x2={i}
              y1={50 - (peak as [number, number])[1] * 50}
              y2={50 - (peak as [number, number])[0] * 50}
              stroke="white"
              strokeWidth="1"
            />
          ))}
        </svg>
      )}
      <div
        className="trim-handle trim-handle-right"
        onMouseDown={(e) => onTrimMouseDown(e, "right", trimRightUs)}
      />
    </div>
  );
}
