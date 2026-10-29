import { Clapperboard, MonitorPlay, Pause, Play } from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import ActionButton from "./ActionButton";
import {
  frameAtOrAfter,
  frameTimeUs,
  resolveSequenceFrame,
} from "../../electron/domain/sequence";
import { itemData } from "../../electron/domain/timeline-item";
import { mediaUrl } from "../lib/bridge";
import type { PreviewProps } from "../lib/preview/types";
import { formatTimeUs } from "../lib/preview/time-utils";
import { usePlayback } from "../hooks/usePlayback";
import { useGraphicPlayback } from "../hooks/useGraphicPlayback";
import { useMediaProxies } from "../hooks/useMediaProxies";
import { useCompositionSize } from "../hooks/useCompositionSize";
import { upcomingLayers } from "../lib/preview/preroll";
import { usePlayheadUs, type Playhead } from "../lib/playhead";
import PreviewMedia from "./PreviewMedia";
import { AudioMixer } from "../lib/preview/AudioMixer";
import type {
  TimelineItem,
  VisualPlacement,
} from "../../electron/shared/ipc-contract";

const GraphicPreview = lazy(() => import("./GraphicCanvas"));

/** The live editor's preview, redrawn by the playhead without the rest of the editor. */
export function PlayheadPreview({
  playhead,
  ...props
}: Omit<PreviewProps, "playheadUs"> & { playhead: Playhead }) {
  return <Preview {...props} playheadUs={usePlayheadUs(playhead)} />;
}

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
  const graphicRender = useGraphicPlayback(props.project, props.projectVersion);
  const playable = useMediaProxies(props.project);
  const layerKey = (layer: { item: TimelineItem }) =>
    `${itemData(layer.item).id}:${props.projectVersion}`;
  const ready = useRef(new Set<string>());
  const [, readyChanged] = useReducer((count: number) => count + 1, 0);
  const onReadyChange = (key: string) => (value: boolean) => {
    if (value === ready.current.has(key)) return;
    if (value) ready.current.add(key);
    else ready.current.delete(key);
    readyChanged();
  };
  const awaited = useRef<string[]>([]);
  awaited.current = (frame?.layers ?? []).flatMap((layer) => {
    const { item, asset, placement } = layer;
    if ("VideoClip" in item) return asset && placement ? [layerKey(layer)] : [];
    if ("AudioClip" in item) return asset ? [layerKey(layer)] : [];
    if ("RemotionGraphic" in item && placement) {
      const render = graphicRender(item.RemotionGraphic);
      return render.path || render.pending ? [layerKey(layer)] : [];
    }
    return [];
  });
  const playback = usePlayback({
    ...props,
    durationUs: frame?.durationUs ?? 0,
    canAdvance: () => awaited.current.every((key) => ready.current.has(key)),
  });
  const scheduled = [
    ...(frame?.layers ?? []).map((layer) => ({ layer, standby: false })),
    ...admitted(
      (props.project && frame
        ? upcomingLayers(props.project, frame.frame)
        : []
      ).filter(
        (layer) =>
          !("RemotionGraphic" in layer.item) ||
          graphicRender(layer.item.RemotionGraphic).path,
      ),
      (layer) => ready.current.has(layerKey(layer)),
    ).map((layer) => ({ layer, standby: true })),
  ];
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
          {scheduled.map(({ layer, standby }) => {
            const { item, asset, placement } = layer;
            const playing = playback.playing && !playback.buffering && !standby;
            const precise = !playback.playing || standby;
            const key = layerKey(layer);
            if ("VideoClip" in item && asset && placement) {
              return (
                <PreviewMedia
                  key={key}
                  mixer={mixer}
                  audioGain={layer.audioGain}
                  path={playable(asset)}
                  timeUs={
                    (precise ? layer.sourceTimeUs : layer.playbackTimeUs) ?? 0
                  }
                  playing={playing}
                  precise={precise}
                  standby={standby}
                  onReadyChange={onReadyChange(key)}
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
                  timeUs={
                    (standby ? layer.sourceTimeUs : layer.playbackTimeUs) ?? 0
                  }
                  playing={playing}
                  precise={precise}
                  standby={standby}
                  onReadyChange={onReadyChange(key)}
                  version={props.projectVersion}
                  fps={settings.fps}
                  onError={reportError}
                />
              );
            }
            if (standby && !("RemotionGraphic" in item)) return null;
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
              const startFrame = frameAtOrAfter(
                graphic.timeline_start_us,
                settings.fps,
              );
              const render = graphicRender(graphic).path;
              if (standby && !render) return null;
              const localFrame = Math.max(0, (frame?.frame ?? 0) - startFrame);
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
                      editable={
                        !playback.playing &&
                        !standby &&
                        !!props.onGraphicSelection
                      }
                      onSelect={props.onGraphicSelection}
                      resources={props.project?.resources ?? []}
                      placement={placement}
                      component={component}
                      item={graphic}
                      frame={localFrame}
                      settings={settings}
                      picture={
                        render && (
                          <PreviewMedia
                            mixer={mixer}
                            path={render}
                            timeUs={
                              precise
                                ? frameMidpointUs(localFrame, settings.fps)
                                : props.playheadUs -
                                  frameTimeUs(startFrame, settings.fps)
                            }
                            playing={playing}
                            precise={precise}
                            standby={standby}
                            onReadyChange={onReadyChange(key)}
                            version={props.projectVersion}
                            fps={settings.fps}
                            style={{
                              position: "absolute",
                              width: "100%",
                              height: "100%",
                            }}
                            onError={reportError}
                          />
                        )
                      }
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
        {playback.buffering && (
          <span className="preview-buffering" role="status">
            Buffering
          </span>
        )}
        <span className="preview-scale">Fit · {Math.round(scale * 100)}%</span>
      </div>
    </section>
  );
}

// Sources sharing one file contend for its index while seeking, so the next cut parks first.
function admitted<T>(upcoming: T[], parked: (layer: T) => boolean): T[] {
  const waiting = upcoming.findIndex((layer) => !parked(layer));
  return waiting === -1 ? upcoming : upcoming.slice(0, waiting + 1);
}

// A frame's start can round below its exact timestamp, which shows the previous frame.
function frameMidpointUs(frame: number, fps: number): number {
  return Math.round(((frame + 0.5) * 1_000_000) / fps);
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
