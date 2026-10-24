import { useEffect, useRef, useMemo, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import type { GraphicResource } from "../../electron/shared/graphic-resources";
import TitleCard, { prepareFont } from "../../electron/graphics/TitleCard";
import type {
  GraphicComponent,
  RemotionGraphicItem,
} from "../../electron/shared/graphics";
import type {
  VisualPlacement,
  ProjectSettings,
} from "../../electron/shared/ipc-contract";
import { frameAtOrAfter } from "../../electron/domain/sequence";
import { graphicFit } from "../lib/preview/graphic-geometry";
import { isPackagedGraphic } from "../lib/preview/graphic-runtime";

export type GraphicPreviewProps = {
  component?: GraphicComponent;
  resources: GraphicResource[];
  item: RemotionGraphicItem;
  frame: number;
  placement: VisualPlacement;
  settings: Pick<ProjectSettings, "width" | "height" | "fps">;
};
export default function GraphicPreview({
  component,
  resources,
  item,
  frame,
  placement,
  settings,
}: GraphicPreviewProps) {
  const inputs = useMemo(
    () =>
      Object.fromEntries(
        resources.map((resource) => [
          resource.id,
          {
            url: `forgecut-resource://resource/${resource.sha256}`,
            sha256: resource.sha256,
            mime: resource.mime,
          },
        ]),
      ),
    [resources],
  );
  const fontId = typeof item.props.font === "string" ? item.props.font : "";
  const font = inputs[fontId];
  const [fontStatus, setFontStatus] = useState({ key: "", error: "" });
  useEffect(() => {
    let cancelled = false;
    if (font)
      void prepareFont(font)
        .then(() => {
          if (!cancelled) setFontStatus({ key: fontId, error: "" });
        })
        .catch((failure: unknown) => {
          if (!cancelled)
            setFontStatus({
              key: fontId,
              error:
                failure instanceof Error ? failure.message : String(failure),
            });
        });
    return () => {
      cancelled = true;
    };
  }, [font, fontId]);
  const player = useRef<PlayerRef>(null);
  const duration = Math.max(
    1,
    frameAtOrAfter(item.timeline_start_us + item.duration_us, settings.fps) -
      frameAtOrAfter(item.timeline_start_us, settings.fps),
  );
  useEffect(() => {
    player.current?.seekTo(Math.min(duration - 1, Math.max(0, frame)));
  }, [frame, duration, fontStatus.key]);
  if (!component || !isPackagedGraphic(component))
    return (
      <span role="alert">
        This component version is unavailable in the graphics runtime.
      </span>
    );
  if (fontId && !font)
    return <span role="alert">The selected font resource is unavailable.</span>;
  if (fontId && fontStatus.key === fontId && fontStatus.error)
    return <span role="alert">Font could not load: {fontStatus.error}</span>;
  if (fontId && fontStatus.key !== fontId)
    return <span role="status">Loading font…</span>;
  const fit = graphicFit(placement, settings);
  const { scale } = fit;
  const width = settings.width * scale;
  const height = settings.height * scale;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <Player
        className="graphic-player"
        ref={player}
        component={TitleCard}
        inputProps={{
          values: item.props,
          resources: inputs,
          layerStates: item.layer_states,
        }}
        errorFallback={({ error }) => (
          <span role="alert">Graphic failed: {error.message}</span>
        )}
        initialFrame={Math.min(duration - 1, Math.max(0, frame))}
        durationInFrames={duration}
        compositionWidth={settings.width}
        compositionHeight={settings.height}
        fps={settings.fps}
        controls={false}
        autoPlay={false}
        clickToPlay={false}
        doubleClickToFullscreen={false}
        spaceKeyToPlayOrPause={false}
        style={{
          position: "absolute",
          width,
          height,
          left: fit.x,
          top: fit.y,
        }}
      />
    </div>
  );
}
