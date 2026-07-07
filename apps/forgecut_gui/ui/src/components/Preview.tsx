import { mediaUrl } from "../lib/bridge";
import type { PreviewProps } from "../lib/preview/types";
import { formatTimeUs } from "../lib/preview/time-utils";
import { usePlayback } from "../hooks/usePlayback";

export default function Preview(props: PreviewProps) {
  const { videoRef, statusMsg, overlays, handlePlayPause, handleEnded } = usePlayback({
    playheadUs: props.playheadUs,
    playing: props.playing,
    onPlayingChange: props.onPlayingChange,
    onPlayheadChange: props.onPlayheadChange,
  });

  return (
    <section className="panel preview">
      <div className="preview-viewport">
        <video
          ref={videoRef}
          className="preview-video"
          playsInline
          onEnded={handleEnded}
        />
        {overlays.map((overlay, i) => {
          if (overlay.ImageOverlay?.file_path) {
            const img = overlay.ImageOverlay;
            return (
              <img
                key={i}
                src={mediaUrl(overlay.ImageOverlay.file_path)}
                style={{
                  position: "absolute",
                  left: `${img.x}px`,
                  top: `${img.y}px`,
                  width: `${img.width}px`,
                  height: `${img.height}px`,
                  opacity: img.opacity,
                  pointerEvents: "none",
                  objectFit: "contain",
                }}
              />
            );
          }

          if (overlay.TextOverlay) {
            const txt = overlay.TextOverlay;
            return (
              <span
                key={i}
                style={{
                  position: "absolute",
                  left: `${txt.x}px`,
                  top: `${txt.y}px`,
                  fontSize: `${txt.font_size}px`,
                  color: txt.color,
                  pointerEvents: "none",
                  textShadow: "0 1px 3px rgba(0,0,0,0.7)",
                  whiteSpace: "nowrap",
                }}
              >
                {txt.text}
              </span>
            );
          }
          return null;
        })}
        {statusMsg && (
          <span className="placeholder-label">{statusMsg}</span>
        )}
      </div>
      <div className="preview-controls">
        <button className="preview-btn" onClick={handlePlayPause}>
          {props.playing ? "⏹" : "▶"}
        </button>
        <span className="preview-time">{formatTimeUs(props.playheadUs)}</span>
      </div>
    </section>
  );
}
