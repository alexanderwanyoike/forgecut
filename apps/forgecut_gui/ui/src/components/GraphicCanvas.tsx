import { useRef } from "react";
import GraphicPreview, { type GraphicPreviewProps } from "./GraphicPreview";
import {
  graphicFit,
  layerBounds,
  orderedLayers,
} from "../lib/preview/graphic-geometry";
import { useGraphicGesture } from "../hooks/useGraphicGesture";

type Props = GraphicPreviewProps & {
  sessionId?: string;
  displayScale?: number;
  revision: number;
  selectedLayerId?: string | null;
  selected?: boolean;
  editable?: boolean;
  onSelect?: (itemId: string, layerId: string) => void;
};
export default function GraphicCanvas(props: Props) {
  const { item, component, placement, settings } = props;
  const stage = useRef<HTMLDivElement>(null);
  const gesture = useGraphicGesture({
    item,
    component,
    sessionId: props.sessionId,
    revision: props.revision,
    width: settings.width,
    height: settings.height,
  });
  const displayed = gesture.draft
    ? { ...item, props: { ...item.props, ...gesture.draft } }
    : item;
  const fit = graphicFit(placement, settings);
  const layers = component ? orderedLayers(component, item) : [];
  return (
    <div
      ref={stage}
      data-graphic-stage={item.id}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      <GraphicPreview {...props} item={displayed} />
      {props.editable &&
        layers.map((layer, index) => {
          const state = item.layer_states?.[layer.id];
          const box = layerBounds(displayed, layer);
          if (
            !box ||
            state?.hidden ||
            state?.locked ||
            (layer.kind === "image" && !item.props[layer.bindings.image])
          )
            return null;
          const selected = props.selected && props.selectedLayerId === layer.id;
          const scale = () => {
            const rect = stage.current?.getBoundingClientRect();
            return rect ? (rect.width / placement.width) * fit.scale : 0;
          };
          const style = {
            position: "absolute" as const,
            left: fit.x + box.x * fit.scale,
            top: fit.y + box.y * fit.scale,
            width: box.width * fit.scale,
            height: box.height * fit.scale,
            zIndex: index + 1,
            pointerEvents: "auto" as const,
            background: "transparent",
            padding: 0,
            border: selected
              ? `${1 / (props.displayScale ?? 1)}px solid #98b9a8`
              : "0",
            cursor: "move",
          };
          return (
            <div key={layer.id} style={style}>
              <button
                type="button"
                aria-label={`Select ${layer.label}`}
                style={{
                  position: "absolute",
                  inset: 0,
                  border: 0,
                  padding: 0,
                  background: "transparent",
                  cursor: "move",
                }}
                onMouseDown={(event) => {
                  props.onSelect?.(item.id, layer.id);
                  gesture.begin(layer, event, scale());
                }}
                onKeyDown={(event) => gesture.nudge(layer, event)}
                onDoubleClick={() => {
                  props.onSelect?.(item.id, layer.id);
                  document
                    .querySelector<HTMLTextAreaElement>(
                      `[data-property-key="${layer.kind === "text" ? layer.bindings.text : ""}"]`,
                    )
                    ?.focus();
                }}
              />
              {selected && (
                <button
                  type="button"
                  aria-label={`Resize ${layer.label}`}
                  style={{
                    position: "absolute",
                    right: 0,
                    bottom: 0,
                    width: 12 / (props.displayScale ?? 1),
                    height: 12 / (props.displayScale ?? 1),
                    background: "#98b9a8",
                    border: 0,
                    cursor: "nwse-resize",
                  }}
                  onMouseDown={(event) =>
                    gesture.begin(layer, event, scale(), true)
                  }
                />
              )}
            </div>
          );
        })}
      {gesture.draft && (
        <>
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: fit.x + (settings.width * fit.scale) / 2,
              top: 0,
              height: "100%",
              borderLeft: "1px dashed #98b9a8",
            }}
          />
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: fit.y + (settings.height * fit.scale) / 2,
              left: 0,
              width: "100%",
              borderTop: "1px dashed #98b9a8",
            }}
          />
        </>
      )}
      {gesture.error && (
        <p
          role="alert"
          style={{ position: "absolute", top: 0, color: "white" }}
        >
          {gesture.error}
        </p>
      )}
    </div>
  );
}
