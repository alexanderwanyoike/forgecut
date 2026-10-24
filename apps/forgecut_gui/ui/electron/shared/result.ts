export type Result<
  T = unknown,
  E extends { code: string; message: string } = {
    code: string;
    message: string;
  },
> = { ok: true; value: T } | { ok: false; error: E };
