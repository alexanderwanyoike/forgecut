import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Player, type PlayerRef } from "@remotion/player";
import { compiledComponent } from "./compiled-component";
import { prepareFont } from "../TitleCard";
import type { GraphicPreviewInput } from "../../shared/graphic-preview";

declare global {
  interface Window {
    graphicPreview: (input: GraphicPreviewInput) => Promise<void>;
  }
}
const container = document.getElementById("root");
if (!container) throw new Error("Missing preview root");
const root = createRoot(container);
let player: PlayerRef | null = null;
let waiting = false;
const assets = new Map<string, Promise<void>>();
const components = new Map<string, ReturnType<typeof compiledComponent>>();
async function preload(input: GraphicPreviewInput) {
  for (const resource of Object.values(input.resources)) {
    let pending = assets.get(resource.sha256);
    if (!pending) {
      if (resource.mime.startsWith("font/")) pending = prepareFont(resource);
      else {
        const image = new Image();
        image.src = resource.url;
        pending = image.decode();
      }
      assets.set(resource.sha256, pending);
    }
    await pending;
  }
  while (assets.size > 64) assets.delete(assets.keys().next().value ?? "");
}
window.graphicPreview = async (input) => {
  await preload(input);
  let Component = components.get(input.key);
  if (!Component) {
    Component = compiledComponent(input.code);
    components.set(input.key, Component);
  }
  while (components.size > 4)
    components.delete(components.keys().next().value ?? "");
  const scale = Math.min(
    1,
    960 / input.width,
    960 / input.height,
    Math.sqrt(518400 / (input.width * input.height)),
  );
  const width = Math.max(1, Math.round(input.width * scale));
  const height = Math.max(1, Math.round(input.height * scale));
  let failure = "";
  waiting = false;
  flushSync(() =>
    root.render(
      <Player
        key={input.key}
        ref={(value) => {
          player = value;
          if (value) {
            value.addEventListener("waiting", () => {
              waiting = true;
            });
            value.addEventListener("resume", () => {
              waiting = false;
            });
            value.addEventListener("error", ({ detail }) => {
              failure = detail.error.message;
            });
          }
        }}
        component={Component}
        inputProps={{
          values: input.values,
          resources: input.resources,
          layerStates: input.layerStates,
        }}
        errorFallback={({ error }) => {
          failure = error.message;
          return null;
        }}
        initialFrame={input.frame}
        durationInFrames={input.duration}
        compositionWidth={input.width}
        compositionHeight={input.height}
        fps={input.fps}
        controls={false}
        autoPlay={false}
        clickToPlay={false}
        spaceKeyToPlayOrPause={false}
        style={{ width, height }}
      />,
    ),
  );
  flushSync(() => player?.seekTo(input.frame));
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  await document.fonts.ready;
  const start = performance.now();
  while (
    waiting ||
    player?.getCurrentFrame() !== input.frame ||
    [...document.images].some((image) => !image.complete)
  ) {
    if (failure) throw new Error(failure);
    if (performance.now() - start > 5000)
      throw new Error("Graphic assets or frame did not become ready");
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
  if (failure) throw new Error(failure);
};
