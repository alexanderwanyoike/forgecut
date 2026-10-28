import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { AudioMixer } from "../lib/preview/AudioMixer";
import { mediaUrl } from "../lib/bridge";
import { usToSeconds } from "../lib/preview/time-utils";
import { mediaSync } from "../lib/preview/media-sync";

type Props = {
  path: string;
  timeUs: number;
  playing: boolean;
  /** Paused by the user or parked: seek to the exact requested frame. */
  precise: boolean;
  version: number;
  fps: number;
  style?: CSSProperties;
  audioOnly?: boolean;
  mixer: AudioMixer;
  audioGain?: number;
  onError: (message: string) => void;
  onPresentedChange?: (presented: boolean) => void;
  /** Parked at its first frame, hidden and paused, until its cut arrives. */
  standby?: boolean;
};

export default function PreviewMedia(props: Props) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const setMedia = useCallback((media: HTMLMediaElement | null) => {
    mediaRef.current = media;
  }, []);
  const gain = useRef<GainNode | null>(null);
  const synchronize = useRef(() => {});
  const epoch = useRef(0);
  const previousPlaying = useRef(props.playing);
  const pendingSeek = useRef(false);
  const [presented, setPresented] = useState(false);
  synchronize.current = () => {
    const media = mediaRef.current;
    if (!media) return;
    if (gain.current) props.mixer.setGain(gain.current, props.audioGain ?? 0);
    if (!props.playing) media.pause();
    const sync = mediaSync(
      {
        readyState: media.readyState,
        currentTime: media.currentTime,
        loading: media.networkState === HTMLMediaElement.NETWORK_LOADING,
        seekPending: pendingSeek.current,
      },
      usToSeconds(props.timeUs),
      props.precise,
    );
    if (sync.wait) return;
    if (sync.seekTo !== undefined) {
      pendingSeek.current = true;
      media.currentTime = sync.seekTo;
    }
    if (sync.presentable) setPresented(true);
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
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return undefined;
    epoch.current += 1;
    pendingSeek.current = false;
    setPresented(false);
    const loaded = () => synchronize.current();
    const seeked = () => {
      pendingSeek.current = false;
      synchronize.current();
    };
    media.addEventListener("loadeddata", loaded);
    media.addEventListener("seeked", seeked);
    media.addEventListener("suspend", loaded);
    synchronize.current();
    return () => {
      epoch.current += 1;
      media.removeEventListener("loadeddata", loaded);
      media.removeEventListener("seeked", seeked);
      media.removeEventListener("suspend", loaded);
      media.pause();
    };
  }, [props.path, props.version]);
  useEffect(() => {
    if (previousPlaying.current !== props.playing) {
      epoch.current += 1;
      previousPlaying.current = props.playing;
    }
    synchronize.current();
  }, [props.playing, props.timeUs, props.audioGain]);
  const report = useRef(props.onPresentedChange);
  report.current = props.onPresentedChange;
  useEffect(() => {
    report.current?.(presented);
  }, [presented]);
  useEffect(() => () => report.current?.(false), []);
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
      style={{
        ...props.style,
        visibility: presented && !props.standby ? "visible" : "hidden",
      }}
      onError={() => props.onError("Unable to play this source.")}
    />
  );
}
