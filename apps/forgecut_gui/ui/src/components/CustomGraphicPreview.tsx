import { useEffect, useRef, useState } from "react";
import type { CommandArgsOf } from "../../electron/shared/ipc-contract";
import { invoke } from "../lib/bridge";
import { graphicFit } from "../lib/preview/graphic-geometry";
import type { GraphicPreviewProps } from "./GraphicPreview";

type Input = CommandArgsOf<"get_graphic_preview">;

export default function CustomGraphicPreview({
  item,
  frame,
  placement,
  settings,
}: GraphicPreviewProps) {
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const queue = useRef({
    mounted: true,
    busy: false,
    pending: null as Input | null,
  });
  const input = JSON.stringify({
    itemId: item.id,
    frame,
    props: item.props,
  } satisfies Input);
  useEffect(() => {
    const state = queue.current;
    state.mounted = true;
    return () => {
      state.mounted = false;
      state.pending = null;
    };
  }, []);
  useEffect(() => {
    const state = queue.current;
    state.pending = JSON.parse(input) as Input;
    if (state.busy) return;
    state.busy = true;
    void (async () => {
      try {
        while (state.mounted && state.pending) {
          const request = state.pending;
          state.pending = null;
          try {
            const result = await invoke("get_graphic_preview", request);
            if (state.mounted) {
              setImage(`data:${result.mimeType};base64,${result.data}`);
              setError("");
            }
          } catch (failure) {
            if (state.mounted)
              setError(
                failure instanceof Error ? failure.message : String(failure),
              );
          }
        }
      } finally {
        state.busy = false;
      }
    })();
  }, [input]);
  const fit = graphicFit(placement, settings);
  return (
    <div data-graphic-ready={ready && !error} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {image ? (
        <img
          alt="Graphic preview"
          src={image}
          draggable={false}
          onLoad={() => setReady(true)}
          onError={() => {
            setReady(false);
            setError("The graphic preview image could not be decoded");
          }}
          style={{
            position: "absolute",
            width: settings.width * fit.scale,
            height: settings.height * fit.scale,
            left: fit.x,
            top: fit.y,
          }}
        />
      ) : (
        !error && <span role="status">Preparing graphic…</span>
      )}
      {error && <span role="alert">Graphic failed: {error}</span>}
    </div>
  );
}
