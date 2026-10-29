/** @vitest-environment node */
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { checkGraphicSource } from "../graphic-source-check";
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, mkdtemp: vi.fn(actual.mkdtemp), rm: vi.fn(actual.rm) };
});
afterEach(() => vi.clearAllMocks());
const source = {
  entry: "main.tsx",
  files: { "main.tsx": "export default ()=>null" },
};
it("returns a typed I/O failure when the temporary directory cannot be created", async () => {
  vi.mocked(mkdtemp).mockRejectedValueOnce(
    Object.assign(new Error("Cannot create compiler temporary directory"), {
      code: "EACCES",
    }),
  );
  await expect(checkGraphicSource(source)).resolves.toMatchObject({
    ok: false,
    error: {
      code: "IO_ERROR",
      message: expect.stringContaining("Cannot create"),
    },
  });
});
it("retains cancellation when compiler temporary cleanup also fails", async () => {
  vi.mocked(rm).mockRejectedValueOnce(
    Object.assign(new Error("Compiler cleanup denied"), { code: "EACCES" }),
  );
  try {
    await expect(
      checkGraphicSource(source, AbortSignal.abort()),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "CANCELLED", message: expect.stringContaining("cleanup") },
    });
  } finally {
    const path = vi.mocked(rm).mock.calls.at(-1)?.[0];
    if (typeof path === "string") {
      const actual =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      await actual.rm(path, { recursive: true, force: true });
    }
  }
});
