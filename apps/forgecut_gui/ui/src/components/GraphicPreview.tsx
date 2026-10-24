import { useEffect, useRef } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import TitleCard from "../../electron/graphics/TitleCard";
import type {
  GraphicComponent,
  RemotionGraphicItem,
} from "../../electron/shared/graphics";
import type {
  VisualPlacement,
  ProjectSettings,
} from "../../electron/shared/ipc-contract";
import { frameAtOrAfter } from "../../electron/domain/sequence";
import { isPackagedGraphic } from "../lib/preview/graphic-runtime";

type Props = {
  component?: GraphicComponent;
  item: RemotionGraphicItem;
  frame: number;
  placement: VisualPlacement;
  settings: Pick<ProjectSettings, "width" | "height" | "fps">;
};
export default function GraphicPreview({
  component,
  item,
  frame,
  placement,
  settings,
}: Props) {
  const player = useRef<PlayerRef>(null);
  const duration = Math.max(
    1,
    frameAtOrAfter(item.timeline_start_us + item.duration_us, settings.fps) -
      frameAtOrAfter(item.timeline_start_us, settings.fps),
  );
  useEffect(() => {
    player.current?.seekTo(Math.min(duration - 1, Math.max(0, frame)));
  }, [frame, duration]);
  if (!component || !isPackagedGraphic(component))
    return (
      <span role="alert">
        This component version is unavailable in the graphics runtime.
      </span>
    );
  const scale = (placement.fit === "cover" ? Math.max : Math.min)(
    placement.width / settings.width,
    placement.height / settings.height,
  );
  const width = settings.width * scale;
  const height = settings.height * scale;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <Player
        className="graphic-player"
        ref={player}
        component={TitleCard}
        inputProps={{ values: item.props }}
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
          left: (placement.width - width) / 2,
          top: (placement.height - height) / 2,
        }}
      />
    </div>
  );
}
