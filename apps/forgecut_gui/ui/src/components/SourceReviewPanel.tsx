import { AudioLines, Images, X } from "lucide-react";
import type {
  Asset,
  ProjectSnapshot,
} from "../../electron/shared/ipc-contract";
import { useSourceReview } from "../hooks/useSourceReview";
import ActionButton from "./ActionButton";

type Props = {
  snapshot: ProjectSnapshot;
  asset: Asset;
  startUs: number;
  endUs: number;
};
export default function SourceReviewPanel({
  snapshot,
  asset,
  startUs,
  endUs,
}: Props) {
  const review = useSourceReview({
    sessionId: snapshot.sessionId,
    expectedRevision: snapshot.revision,
    assetId: asset.id,
    startUs,
    endUs,
  });
  const valid =
    startUs >= 0 &&
    endUs <= (asset.probe?.duration_us ?? 0) &&
    endUs - startUs >= 100000 &&
    endUs - startUs <= 30000000;
  const output = review.result?.ok ? review.result.value : null;
  return (
    <div className="source-review">
      <div className="source-review-controls">
        <ActionButton
          icon={Images}
          disabled={review.busy || !valid || asset.kind !== "Video"}
          tooltip="Generate 12 frames from this source range"
          onClick={() => {
            void review.start("contact-sheet");
          }}
        >
          Contact sheet
        </ActionButton>
        <ActionButton
          icon={AudioLines}
          disabled={review.busy || !valid || !asset.probe?.audio_channels}
          tooltip="Generate waveform peaks from this source range"
          onClick={() => {
            void review.start("waveform");
          }}
        >
          Waveform
        </ActionButton>
        {review.busy && (
          <ActionButton
            icon={X}
            tooltip="Cancel source review"
            onClick={review.cancel}
          >
            Cancel
          </ActionButton>
        )}
      </div>
      {!valid && <p>Choose a range between 0.1 and 30 seconds to review.</p>}
      {review.status && <p role="status">Source review: {review.status}</p>}
      {review.result && !review.result.ok && (
        <p role="alert">{review.result.error.message}</p>
      )}
      {output && "peaks" in output && (
        <figure>
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
          <figcaption>
            {(output.startUs / 1000000).toFixed(3)} to{" "}
            {(output.endUs / 1000000).toFixed(3)} seconds
          </figcaption>
        </figure>
      )}
      {output && "mimeType" in output && (
        <figure>
          <img
            src={`data:${output.mimeType};base64,${output.data}`}
            alt="Source contact sheet"
          />
          <figcaption>
            {(output.startUs / 1000000).toFixed(3)} to{" "}
            {(output.endUs / 1000000).toFixed(3)} seconds
          </figcaption>
        </figure>
      )}
    </div>
  );
}
