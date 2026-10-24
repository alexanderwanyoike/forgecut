import { ArrowLeft, AudioLines, Film, Images, X } from "lucide-react";
import type {
  Asset,
  ProjectSnapshot,
} from "../../electron/shared/ipc-contract";
import { useSourceReview } from "../hooks/useSourceReview";
import ActionButton from "./ActionButton";
import SourceReviewOutput from "./SourceReviewOutput";

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
        <ActionButton
          icon={Film}
          disabled={
            review.busy ||
            !valid ||
            endUs - startUs > 5000000 ||
            asset.kind !== "Video"
          }
          tooltip="Generate a short video preview with available audio"
          onClick={() => {
            void review.start("preview");
          }}
        >
          Short preview
        </ActionButton>
        {output && "mimeType" in output && output.mimeType === "video/webm" && (
          <ActionButton icon={ArrowLeft} onClick={review.clear}>
            Back to source
          </ActionButton>
        )}
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
      {valid && asset.kind === "Video" && endUs - startUs > 5000000 && (
        <p>Choose a range up to 5 seconds for a video preview.</p>
      )}
      {!valid && <p>Choose a range between 0.1 and 30 seconds to review.</p>}
      {review.status && <p role="status">Source review: {review.status}</p>}
      {review.result && !review.result.ok && (
        <p role="alert">{review.result.error.message}</p>
      )}
      {output && <SourceReviewOutput output={output} />}
    </div>
  );
}
