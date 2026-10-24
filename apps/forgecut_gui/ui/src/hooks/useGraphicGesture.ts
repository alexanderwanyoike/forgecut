import {
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type KeyboardEvent,
} from "react";
import type {
  GraphicComponent,
  GraphicLayer,
  GraphicValues,
  RemotionGraphicItem,
} from "../../electron/shared/graphics";
import { invoke } from "../lib/bridge";
import { layerBounds } from "../lib/preview/graphic-geometry";

type Gesture = {
  layer: GraphicLayer;
  x: number;
  y: number;
  scale: number;
  resize: boolean;
  next: GraphicValues;
};
type Input = {
  item: RemotionGraphicItem;
  component?: GraphicComponent;
  sessionId?: string;
  revision: number;
  width: number;
  height: number;
};
export function useGraphicGesture({
  item,
  component,
  sessionId,
  revision,
  width,
  height,
}: Input) {
  const active = useRef<Gesture | null>(null);
  const [draft, setDraft] = useState<GraphicValues | null>(null);
  const [error, setError] = useState("");
  const cancel = () => {
    active.current = null;
    setDraft(null);
  };
  const commit = async (values: GraphicValues) => {
    if (!sessionId || Object.keys(values).length === 0) {
      cancel();
      return;
    }
    try {
      await invoke("apply_edits", {
        sessionId,
        expectedRevision: revision,
        requestId: crypto.randomUUID(),
        operations: [
          {
            command: "update_item",
            args: {
              itemId: item.id,
              patch: { kind: "RemotionGraphic", changes: { props: values } },
            },
          },
        ],
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setDraft(null);
    }
  };
  const latest = useRef({ item, component, width, height, commit });
  latest.current = { item, component, width, height, commit };
  useLayoutEffect(() => {
    const move = (event: globalThis.MouseEvent) => {
      const gesture = active.current;
      if (!gesture) return;
      const { current } = latest;
      const bounds = layerBounds(current.item, gesture.layer);
      if (!bounds) return;
      const dx = (event.clientX - gesture.x) / gesture.scale;
      const dy = (event.clientY - gesture.y) / gesture.scale;
      const { bindings } = gesture.layer;
      const next: GraphicValues = {};
      if (gesture.resize) {
        for (const [key, value] of [
          [bindings.width, bounds.width + dx],
          [bindings.height, bounds.height + dy],
        ] as const) {
          const property = current.component?.properties[key];
          next[key] = Math.max(
            property?.type === "number" ? (property.min ?? 1) : 1,
            Math.min(
              property?.type === "number"
                ? (property.max ?? Infinity)
                : Infinity,
              value,
            ),
          );
        }
      } else {
        let x = bounds.x + dx;
        let y = bounds.y + dy;
        if (
          Math.abs(x + bounds.width / 2 - current.width / 2) * gesture.scale <
          6
        )
          x = (current.width - bounds.width) / 2;
        if (
          Math.abs(y + bounds.height / 2 - current.height / 2) * gesture.scale <
          6
        )
          y = (current.height - bounds.height) / 2;
        next[bindings.x] = x;
        next[bindings.y] = y;
      }
      gesture.next = next;
      setDraft(next);
    };
    const up = () => {
      const gesture = active.current;
      active.current = null;
      if (gesture) void latest.current.commit(gesture.next);
    };
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("keydown", key);
    return () => {
      active.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("keydown", key);
    };
  }, [item.id, component?.version, sessionId, revision, width, height]);
  const begin = (
    layer: GraphicLayer,
    event: MouseEvent<HTMLButtonElement>,
    scale: number,
    resize = false,
  ) => {
    if (
      event.button !== 0 ||
      !sessionId ||
      item.layer_states?.[layer.id]?.locked ||
      item.layer_states?.[layer.id]?.hidden ||
      scale <= 0
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    setError("");
    active.current = {
      layer,
      x: event.clientX,
      y: event.clientY,
      scale,
      resize,
      next: {},
    };
  };
  const nudge = (layer: GraphicLayer, event: KeyboardEvent) => {
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const delta = deltas[event.key];
    const bounds = layerBounds(item, layer);
    if (
      !delta ||
      !bounds ||
      item.layer_states?.[layer.id]?.locked ||
      item.layer_states?.[layer.id]?.hidden
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 10 : 1;
    void commit({
      [layer.bindings.x]: bounds.x + delta[0] * step,
      [layer.bindings.y]: bounds.y + delta[1] * step,
    });
  };
  return { draft, error, begin, nudge, change: commit };
}
