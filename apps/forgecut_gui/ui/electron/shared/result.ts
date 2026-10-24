export type Result<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };
