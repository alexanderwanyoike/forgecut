import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { AudioMixer } from "../lib/preview/AudioMixer";
import { mediaUrl } from "../lib/bridge";
import { usToSeconds } from "../lib/preview/time-utils";

type Props = {
  path: string;
  timeUs: number;
  playing: boolean;
  version: number;
  fps: number;
  style?: CSSProperties;
  audioOnly?: boolean;
  mixer: AudioMixer;
  audioGain?: number;
  onError: (message: string) => void;
};

export default function PreviewMedia(props: Props) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const pendingSeek = useRef(false);
  const setMedia = useCallback((media: HTMLMediaElement | null) => {
    mediaRef.current = media;
  }, []);
  const gain = useRef<GainNode | null>(null);
  const synchronize = useRef(() => {});
  const epoch = useRef(0);
  const previousPlaying = useRef(props.playing);
  synchronize.current = () => {
    const media = mediaRef.current;
    if (!media) return;
    if (gain.current) props.mixer.setGain(gain.current, props.audioGain ?? 0);
    if (!props.playing) media.pause();
    if (media.readyState < 1) {
      setFrameReady(false);
      return;
    }
    const target = usToSeconds(props.timeUs);
    const tolerance = props.playing
      ? Math.max(0.03, Math.min(0.05, 1 / props.fps))
      : 0.001;
    if (Math.abs(media.currentTime - target) > tolerance) {
      // Matroska index reads may still be in flight after loadeddata.
      if (
        media.readyState < 2 ||
        media.networkState === HTMLMediaElement.NETWORK_LOADING
      ) {
        if (!props.playing) setFrameReady(false);
        return;
      }
      setFrameReady(false);
      pendingSeek.current = true;
      media.currentTime = target;
    }
    setFrameReady(
      !pendingSeek.current && !media.seeking && media.readyState >= 2,
    );
    if (props.playing && media.paused) {
      const { current } = epoch;
      void props.mixer.resume().then((result) => {
        if (!result.ok && current === epoch.current)
          props.onError(result.error.message);
      });
      void media.play().catch((error: unknown) => {
        if (current === epoch.current) props.onError(String(error));
      });
    }
  };
  const audible = props.audioGain !== undefined;
  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !audible) return undefined;
    const connection = props.mixer.connect(media);
    if (!connection.ok) {
      media.muted = true;
      props.onError(connection.error.message);
      return undefined;
    }
    gain.current = connection.value;
    synchronize.current();
    return () => {
      gain.current = null;
      props.mixer.disconnect(media);
    };
  }, [props.mixer, props.path, props.version, audible]);
  useLayoutEffect(() => {
    const media = mediaRef.current;
    if (!media) return undefined;
    pendingSeek.current = false;
    setFrameReady(false);
    epoch.current += 1;
    const loaded = () => synchronize.current();
    const seeking = () => setFrameReady(false);
    const seeked = () => {
      const completed = pendingSeek.current;
      pendingSeek.current = false;
      if (completed && !media.seeking && media.readyState >= 2)
        setFrameReady(true);
      synchronize.current();
    };
    media.addEventListener("loadeddata", loaded);
    media.addEventListener("seeking", seeking);
    media.addEventListener("seeked", seeked);
    media.addEventListener("suspend", loaded);
    synchronize.current();
    return () => {
      epoch.current += 1;
      media.removeEventListener("loadeddata", loaded);
      media.removeEventListener("seeking", seeking);
      media.removeEventListener("seeked", seeked);
      media.removeEventListener("suspend", loaded);
      media.pause();
    };
  }, [props.path, props.version]);
  useLayoutEffect(() => {
    if (previousPlaying.current !== props.playing) {
      epoch.current += 1;
      previousPlaying.current = props.playing;
    }
    synchronize.current();
  }, [props.playing, props.timeUs, props.audioGain]);
  const Media = props.audioOnly ? "audio" : "video";
  return (
    <Media
      ref={setMedia}
      className={props.audioOnly ? undefined : "preview-video"}
      hidden={props.audioOnly}
      crossOrigin="anonymous"
      muted={!audible}
      src={mediaUrl(props.path)}
      playsInline
      preload="auto"
      style={{ ...props.style, visibility: frameReady ? "visible" : "hidden" }}
      onError={() => props.onError("Unable to play this source.")}
    />
  );
}
