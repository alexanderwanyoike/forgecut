import { useState } from "react";
import type { ReviewRange } from "../../electron/shared/ipc-contract";
import type { Result } from "../../electron/shared/result";
import {
  MIN_REVIEW_DURATION_US,
  validateReviewRange,
} from "../../electron/domain/review-range";

type Props = {
  durationUs?: number;
  playheadUs?: number;
  disabled: boolean;
  onChange: (range: Result<ReviewRange | undefined>) => void;
};
export default function ReviewExportControls({
  durationUs = 0,
  playheadUs = 0,
  disabled,
  onChange,
}: Props) {
  const initialStart = Math.min(
    Math.max(0, playheadUs),
    Math.max(0, durationUs - MIN_REVIEW_DURATION_US),
  );
  const [enabled, setEnabled] = useState(false);
  const [start, setStart] = useState(String(initialStart / 1000000));
  const [end, setEnd] = useState(
    String(Math.min(durationUs, initialStart + 5000000) / 1000000),
  );
  const [error, setError] = useState("");
  function update(nextEnabled: boolean, nextStart = start, nextEnd = end) {
    setEnabled(nextEnabled);
    setStart(nextStart);
    setEnd(nextEnd);
    if (!nextEnabled) {
      setError("");
      onChange({ ok: true, value: undefined });
      return;
    }
    const range = {
      startUs: nextStart.trim()
        ? Math.round(Number(nextStart) * 1000000)
        : Number.NaN,
      endUs: nextEnd.trim()
        ? Math.round(Number(nextEnd) * 1000000)
        : Number.NaN,
    };
    const result = validateReviewRange(range, durationUs);
    setError(result.ok ? "" : result.error.message);
    onChange(result);
  }
  if (!durationUs) return null;
  return (
    <fieldset className="review-export-controls" disabled={disabled}>
      <label className="review-export-toggle">
        <input
          type="checkbox"
          checked={enabled}
          disabled={durationUs < MIN_REVIEW_DURATION_US}
          onChange={(event) => update(event.target.checked)}
        />
        Review a range
      </label>
      {enabled && (
        <>
          <div className="review-export-fields">
            <label>
              Review start (s)
              <input
                type="number"
                min={0}
                max={durationUs / 1000000}
                step={0.001}
                value={start}
                onChange={(event) => update(true, event.target.value, end)}
              />
            </label>
            <label>
              Review end (s)
              <input
                type="number"
                min={0}
                max={durationUs / 1000000}
                step={0.001}
                value={end}
                onChange={(event) => update(true, start, event.target.value)}
              />
            </label>
          </div>
          <p>Ranges align to sequence frames.</p>
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </fieldset>
  );
}
