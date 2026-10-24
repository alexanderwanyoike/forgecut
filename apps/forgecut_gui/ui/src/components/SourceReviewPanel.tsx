import { Images, X } from "lucide-react";
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
