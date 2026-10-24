import { useEffect, useRef, type CSSProperties } from "react";
import { mediaUrl } from "../lib/bridge";
import { usToSeconds } from "../lib/preview/time-utils";

type Props = {
  path: string;
  timeUs: number;
  playing: boolean;
  version: number;
  fps: number;
  style: CSSProperties;
  onError: (message: string) => void;
};

export default function PreviewMedia(props: Props) {
  const mediaRef = useRef<HTMLVideoElement>(null);
  const synchronize = useRef(() => {});
  const epoch = useRef(0);
  synchronize.current = () => {
    const media = mediaRef.current;
    if (!media || media.readyState < 1) return;
    const target = usToSeconds(props.timeUs);
    const tolerance = props.playing ? Math.max(0.03, 1 / props.fps) : 0.001;
    if (Math.abs(media.currentTime - target) > tolerance)
      media.currentTime = target;
    if (!props.playing) media.pause();
    else if (media.paused) {
      const { current } = epoch;
      void media.play().catch((error: unknown) => {
        if (current === epoch.current) props.onError(String(error));
      });
    }
  };
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return undefined;
    epoch.current += 1;
    const loaded = () => synchronize.current();
    media.addEventListener("loadedmetadata", loaded);
    synchronize.current();
    return () => {
      epoch.current += 1;
      media.removeEventListener("loadedmetadata", loaded);
      media.pause();
    };
  }, [props.path, props.version]);
  useEffect(() => {
    synchronize.current();
  }, [props.playing, props.timeUs]);
  return (
    <video
      ref={mediaRef}
      className="preview-video"
      src={mediaUrl(props.path)}
      playsInline
      preload="auto"
      style={props.style}
      onError={() => props.onError("Unable to play this source.")}
    />
  );
}
