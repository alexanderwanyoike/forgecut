import { ArrowLeft, Film } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Asset } from "../../electron/shared/ipc-contract";
import { mediaUrl } from "../lib/bridge";
import ActionButton from "./ActionButton";

type Props = { asset: Asset | undefined; onClose: () => void };

export default function SourceMonitor({ asset, onClose }: Props) {
  const media = useRef<HTMLMediaElement | null>(null);
  useEffect(() => {
    const element = media.current;
    return () => element?.pause();
  }, [asset?.path]);
  return (
    <section className="panel source-monitor">
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
        {!asset ? (
          <p role="alert">The source is no longer available.</p>
        ) : asset.kind === "Audio" ? (
          <audio
            key={asset.path}
            ref={(element) => {
              media.current = element;
            }}
            controls
            src={mediaUrl(asset.path)}
          />
        ) : (
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
      <div className="source-monitor-help">
        Choose source in and out points, then create a selection.
      </div>
    </section>
  );
}
