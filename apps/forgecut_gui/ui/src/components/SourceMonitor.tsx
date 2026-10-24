import { ArrowLeft, Film } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { Asset } from "../../electron/shared/ipc-contract";
import { mediaUrl } from "../lib/bridge";
import ActionButton from "./ActionButton";

type Props = {
  asset: Asset | undefined;
  onClose: () => void;
  children?: ReactNode;
};

export default function SourceMonitor({ asset, onClose, children }: Props) {
  const media = useRef<HTMLMediaElement | null>(null);
  useEffect(() => {
    const element = media.current;
    return () => element?.pause();
  }, [asset?.path]);
  return (
    <section
      className="panel source-monitor"
      onKeyDown={(event) => event.stopPropagation()}
      onPlayCapture={(event) => {
        event.currentTarget
          .querySelectorAll<HTMLMediaElement>("audio, video")
          .forEach((element) => {
            if (element !== event.target) element.pause();
          });
      }}
    >
      <div className="panel-header">
        <span>
          <Film size={15} aria-hidden="true" />
          Source monitor
        </span>
        <ActionButton icon={ArrowLeft} onClick={onClose}>
          Canvas
        </ActionButton>
      </div>
      <div className="source-monitor-name" title={asset?.name}>
        {asset?.name ?? "Source unavailable"}
      </div>
      <div className="source-media-stage">
        {!asset && <p role="alert">The source is no longer available.</p>}
        {asset?.kind === "Audio" && (
          <audio
            key={asset.path}
            ref={(element) => {
              media.current = element;
            }}
            controls
            src={mediaUrl(asset.path)}
          />
        )}
        {asset && asset.kind !== "Audio" && (
          <video
            key={asset.path}
            ref={(element) => {
              media.current = element;
            }}
            controls
            src={mediaUrl(asset.path)}
          />
        )}
      </div>
      {children}
      <div className="source-monitor-help">
        Choose source in and out points, then create a selection.
      </div>
    </section>
  );
}
