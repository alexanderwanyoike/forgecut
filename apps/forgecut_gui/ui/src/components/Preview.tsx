import { Clapperboard, MonitorPlay, Pause, Play } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type CSSProperties } from "react";
import ActionButton from "./ActionButton";
import {
  frameAtOrAfter,
  resolveSequenceFrame,
} from "../../electron/domain/sequence";
import { itemData } from "../../electron/domain/timeline-item";
import { mediaUrl } from "../lib/bridge";
import type { PreviewProps } from "../lib/preview/types";
import { formatTimeUs } from "../lib/preview/time-utils";
import { usePlayback } from "../hooks/usePlayback";
import { useCompositionSize } from "../hooks/useCompositionSize";
import PreviewMedia from "./PreviewMedia";
import { AudioMixer } from "../lib/preview/AudioMixer";
import type { VisualPlacement } from "../../electron/shared/ipc-contract";

const GraphicPreview = lazy(() => import("./GraphicCanvas"));

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
    canAdvance: () =>
      Array.from(
        viewportRef.current?.querySelectorAll<HTMLMediaElement>(
          "video:not([data-preroll]), audio:not([data-preroll])",
        ) ?? [],
      ).every(
        (media) =>
          media.readyState >= 2 &&
          !media.seeking &&
          media.style.visibility !== "hidden",
      ),
  });
  return (
    <section className="panel preview">
      <div className="panel-header">
        <span>
          <MonitorPlay size={15} aria-hidden="true" />
          Canvas
        </span>
        <span className="panel-detail">
          {settings.width} × {settings.height}
          <span className="detail-divider">/</span>
          {settings.fps} fps
        </span>
      </div>
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
            const { item, asset, placement } = layer;
            const data = itemData(item);
            const key = `${data.id}:${props.projectVersion}`;
            if ("VideoClip" in item && asset && placement) {
              return (
                <PreviewMedia
                  key={key}
                  mixer={mixer}
                  audioGain={layer.audioGain}
                  path={asset.path}
                  timeUs={
                    (playback.playing
                      ? layer.playbackTimeUs
                      : layer.sourceTimeUs) ?? 0
                  }
                  playing={playback.playing}
                  version={props.projectVersion}
                  fps={settings.fps}
                  style={visualStyle(placement)}
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
                  timeUs={layer.playbackTimeUs ?? 0}
                  playing={playback.playing}
                  version={props.projectVersion}
                  fps={settings.fps}
                  onError={reportError}
                />
              );
            }
            if ("ImageOverlay" in item && asset && placement) {
              return (
                <img
                  key={key}
                  alt={asset.name}
                  src={mediaUrl(asset.path)}
                  style={visualStyle(placement)}
                />
              );
            }
            if ("RemotionGraphic" in item && placement) {
              const graphic = item.RemotionGraphic;
              const component = props.project?.components?.find(
                (candidate) =>
                  candidate.id === graphic.component_id &&
                  candidate.version === graphic.component_version,
              );
              return (
                <div key={key} style={visualStyle(placement)}>
                  <Suspense fallback={<span>Loading graphic…</span>}>
                    <GraphicPreview
                      displayScale={scale}
                      sessionId={props.sessionId}
                      revision={props.projectVersion}
                      selected={props.selectedClipId === graphic.id}
                      selectedLayerId={props.selectedLayerId}
                      editable={!playback.playing && !!props.onGraphicSelection}
                      onSelect={props.onGraphicSelection}
                      resources={props.project?.resources ?? []}
                      placement={placement}
                      component={component}
                      item={graphic}
                      frame={
                        frame.frame -
                        frameAtOrAfter(graphic.timeline_start_us, settings.fps)
                      }
                      settings={settings}
                    />
                  </Suspense>
                </div>
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
          <div className="canvas-empty">
            <Clapperboard size={32} strokeWidth={1.2} aria-hidden="true" />
            <strong>No clips yet</strong>
            <span>Import media to start editing</span>
          </div>
        )}
        {error.key === sourceKey && error.message && (
          <span className="placeholder-label" role="alert">
            {error.message}
          </span>
        )}
      </div>
      <div className="preview-controls">
        <ActionButton
          className="transport-play primary-action"
          icon={props.playing ? Pause : Play}
          iconOnly
          tooltip={props.playing ? "Pause sequence" : "Play sequence"}
          aria-label={props.playing ? "Pause sequence" : "Play sequence"}
          onClick={playback.handlePlayPause}
        />
        <span className="preview-time">{formatTimeUs(props.playheadUs)}</span>
        <span className="preview-duration">
          / {formatTimeUs(frame?.durationUs ?? 0)}
        </span>
        <span className="preview-scale">Fit · {Math.round(scale * 100)}%</span>
      </div>
    </section>
  );
}

function visualStyle(placement: VisualPlacement): CSSProperties {
  return {
    position: "absolute",
    left: placement.x,
    top: placement.y,
    width: placement.width,
    height: placement.height,
    opacity: placement.opacity,
    objectFit: placement.fit,
    background: "transparent",
    pointerEvents: "none",
  };
}
