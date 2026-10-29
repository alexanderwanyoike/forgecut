import type { ProjectSequence } from "../shared/ipc-contract.js";
import type { Result } from "../shared/result.js";
import { durationUs, itemData, itemVariant } from "./timeline-item.js";

export function syncVariantTiming(
  target: ProjectSequence,
  source: ProjectSequence,
  itemIds: string[],
): Result<void> {
  const original = new Map(
    source.timeline.tracks.flatMap((track) =>
      track.items.map((item) => [itemData(item).id, item] as const),
    ),
  );
  const copies = new Map(
    target.timeline.tracks.flatMap((track) =>
      track.items.map((item) => [itemData(item).id, item] as const),
    ),
  );
  for (const id of itemIds) {
    const copy = copies.get(id);
    const data = copy ? itemData(copy) : undefined;
    const origin = data?.origin_item_id
      ? original.get(data.origin_item_id)
      : undefined;
    if (!copy || !data || !origin)
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message:
            "A selected item or its originating source item is unavailable",
        },
      };
    if (itemVariant(copy) !== itemVariant(origin))
      return {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: "Source and variant item kinds must match for timing sync",
        },
      };
    data.timeline_start_us = itemData(origin).timeline_start_us;
    if ("source_in_us" in data)
      data.source_out_us = data.source_in_us + durationUs(origin);
    else data.duration_us = durationUs(origin);
  }
  return { ok: true, value: undefined };
}
