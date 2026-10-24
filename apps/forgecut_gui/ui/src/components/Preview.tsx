import { useEffect, useState } from "react";
import { resolveSequenceFrame } from "../../electron/domain/sequence";
import { itemData } from "../../electron/domain/timeline-item";
import { mediaUrl } from "../lib/bridge";
import type { PreviewProps } from "../lib/preview/types";
import { formatTimeUs } from "../lib/preview/time-utils";
import { usePlayback } from "../hooks/usePlayback";
import { useCompositionSize } from "../hooks/useCompositionSize";
import PreviewMedia from "./PreviewMedia";
import { AudioMixer } from "../lib/preview/AudioMixer";

export default function Preview(props: PreviewProps) {
  const [mixer] = useState(() => new AudioMixer());
  useEffect(
    () => () => {
      void mixer
        .close()
        .catch((failure: unknown) =>
          console.warn("Audio cleanup failed", failure),
        );
    },
    [mixer],
  );
  const [error, setError] = useState({ key: "", message: "" });
  const frame = props.project
    ? resolveSequenceFrame(props.project, props.playheadUs)
    : null;
  const sourceKey = `${props.projectVersion}:${frame?.layers.map((layer) => itemData(layer.item).id).join(":") ?? ""}`;
  const reportError = (message: string) =>
    setError({ key: sourceKey, message });
  const settings = frame?.settings ?? { width: 1920, height: 1080, fps: 30 };
  const { viewportRef, scale } = useCompositionSize(
    settings.width,
    settings.height,
  );
  const playback = usePlayback({
    ...props,
    durationUs: frame?.durationUs ?? 0,
  });
  const primary = props.project?.timeline.tracks.find(
    (track) => track.kind === "Video",
  )?.id;
  return (
    <section className="panel preview">
      <div className="preview-viewport" ref={viewportRef}>
        <div
          className="preview-composition"
          style={{
            position: "relative",
            flexShrink: 0,
            width: settings.width,
            height: settings.height,
            transform: `scale(${scale})`,
            overflow: "hidden",
            background: "#000",
          }}
        >
          {frame?.layers.map((layer) => {
            const { item, asset } = layer;
            const data = itemData(item);
            const key = `${data.id}:${props.projectVersion}`;
            if ("VideoClip" in item && asset) {
              const pip = item.VideoClip.track_id !== primary;
              const width = pip
                ? Math.trunc(settings.width / 4)
                : settings.width;
              const height = pip
                ? Math.trunc(settings.height / 4)
                : settings.height;
              return (
                <PreviewMedia
                  key={key}
                  mixer={mixer}
                  audioGain={layer.audioGain}
                  path={asset.path}
                  timeUs={layer.sourceTimeUs ?? 0}
                  playing={playback.playing}
                  version={props.projectVersion}
                  fps={settings.fps}
                  style={{
                    position: "absolute",
                    width,
                    height,
                    left: pip ? settings.width - width - 20 : 0,
                    top: pip ? settings.height - height - 20 : 0,
                  }}
                  onError={reportError}
                />
              );
            }
            if ("AudioClip" in item && asset) {
              return (
                <PreviewMedia
                  key={key}
                  mixer={mixer}
                  audioOnly
                  audioGain={layer.audioGain}
                  path={asset.path}
                  timeUs={layer.sourceTimeUs ?? 0}
                  playing={playback.playing}
                  version={props.projectVersion}
                  fps={settings.fps}
                  onError={reportError}
                />
              );
            }
            if ("ImageOverlay" in item && asset) {
              const image = item.ImageOverlay;
              return (
                <img
                  key={key}
                  alt={asset.name}
                  src={mediaUrl(asset.path)}
                  style={{
                    position: "absolute",
                    left: image.x,
                    top: image.y,
                    width: image.width,
                    height: image.height,
                    opacity: image.opacity,
                    objectFit: "contain",
                    pointerEvents: "none",
                  }}
                />
              );
            }
            if ("TextOverlay" in item) {
              const text = item.TextOverlay;
              return (
                <span
                  key={key}
                  style={{
                    position: "absolute",
                    left: text.x,
                    top: text.y,
                    fontSize: text.font_size,
                    color: text.color,
                    whiteSpace: "pre",
                    fontFamily: "sans-serif",
                    pointerEvents: "none",
                  }}
                >
                  {text.text}
                </span>
              );
            }
            return null;
          })}
        </div>
        {!frame?.durationUs && (
          <span className="placeholder-label">
            Import a clip and drag it to the timeline
          </span>
        )}
        {error.key === sourceKey && error.message && (
          <span className="placeholder-label" role="alert">
            {error.message}
          </span>
        )}
      </div>
      <div className="preview-controls">
        <button
          className="preview-btn"
          aria-label={props.playing ? "Pause sequence" : "Play sequence"}
          onClick={playback.handlePlayPause}
        >
          {props.playing ? "⏹" : "▶"}
        </button>
        <span className="preview-time">{formatTimeUs(props.playheadUs)}</span>
      </div>
    </section>
  );
}
