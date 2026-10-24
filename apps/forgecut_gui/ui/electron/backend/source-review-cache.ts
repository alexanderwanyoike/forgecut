import type { SourceReview } from "../shared/source-review.js";

const entries = new Map<string, { value: SourceReview; bytes: number }>();
let retainedBytes = 0;
export function cachedSourceReview(key: string): SourceReview | undefined {
  const cached = entries.get(key);
  if (!cached) return undefined;
  entries.delete(key);
  entries.set(key, cached);
  return structuredClone(cached.value);
}
export function retainSourceReview(key: string, value: SourceReview): void {
  const previous = entries.get(key);
  if (previous) retainedBytes -= previous.bytes;
  entries.delete(key);
  const bytes = Buffer.byteLength(JSON.stringify(value));
  entries.set(key, { value: structuredClone(value), bytes });
  retainedBytes += bytes;
  while (entries.size > 64 || retainedBytes > 8 * 1024 * 1024) {
    const oldest = entries.keys().next().value;
    if (!oldest) break;
    retainedBytes -= entries.get(oldest)!.bytes;
    entries.delete(oldest);
  }
}
