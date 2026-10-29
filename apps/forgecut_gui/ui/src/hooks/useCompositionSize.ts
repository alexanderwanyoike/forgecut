import { useLayoutEffect, useRef, useState } from "react";

export function useCompositionSize(width: number, height: number) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width, height });
  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return undefined;
    const measure = () =>
      setSize({
        width: node.clientWidth || width,
        height: node.clientHeight || height,
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [width, height]);
  return {
    viewportRef,
    scale: Math.min(size.width / width, size.height / height),
  };
}
