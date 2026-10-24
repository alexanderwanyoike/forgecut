import { useEffect, useRef } from "react";
import type { SourceReview } from "../../electron/shared/source-review";

export default function SourceReviewOutput({
  output,
}: {
  output: SourceReview;
}) {
  const preview = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const media = preview.current;
    return () => media?.pause();
  }, [output]);
  return (
    <figure>
      {"mimeType" in output ? (
        output.mimeType === "video/webm" ? (
          <video
            ref={preview}
            controls
            preload="metadata"
            aria-label="Source preview"
            src={`data:${output.mimeType};base64,${output.data}`}
          />
        ) : (
          <img
            src={`data:${output.mimeType};base64,${output.data}`}
            alt="Source contact sheet"
          />
        )
      ) : (
        <svg
          role="img"
          aria-label="Source waveform"
          viewBox={`0 0 ${output.peaks.length} 100`}
          preserveAspectRatio="none"
          className="source-waveform"
        >
          {output.peaks.map(([low, high], index) => (
            <line
              key={index}
              x1={index + 0.5}
              x2={index + 0.5}
              y1={50 - high * 48}
              y2={50 - low * 48}
            />
          ))}
        </svg>
      )}
      <figcaption>
        {(output.startUs / 1000000).toFixed(3)} to{" "}
        {(output.endUs / 1000000).toFixed(3)} seconds
      </figcaption>
    </figure>
  );
}
