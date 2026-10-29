import { useEffect, useRef, useState } from "react";
import type { SourcePreview } from "../../electron/shared/source-review";

export default function SourcePreviewPlayer({
  output,
}: {
  output: SourcePreview;
}) {
  const media = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const bytes = Uint8Array.from(atob(output.data), (character) =>
      character.charCodeAt(0),
    );
    const source = URL.createObjectURL(
      new Blob([bytes], { type: output.mimeType }),
    );
    const element = media.current;
    setUrl(source);
    return () => {
      element?.pause();
      URL.revokeObjectURL(source);
    };
  }, [output.data, output.mimeType]);
  return (
    <video
      ref={media}
      controls
      preload="metadata"
      aria-label="Source preview"
      src={url}
    />
  );
}
