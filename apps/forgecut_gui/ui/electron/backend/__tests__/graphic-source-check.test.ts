/** @vitest-environment node */
import { expect, it } from "vitest";
import { AppState } from "../state";
import { EditingService } from "../editing-service";

it("checks typed local TSX files without executing component code", async () => {
  const state = new AppState();
  const service = new EditingService(state);
  const before = state.snapshot();
  const checked = await service.execute("check_graphic_source", {
    source: {
      entry: "main.tsx",
      files: {
        "main.tsx":
          'import {label} from "./label"; import {useCurrentFrame} from "remotion"; globalThis.__forgecutCompileSentinel = "executed"; export default function Card(){return <div>{label} {useCurrentFrame()}</div>}',
        "label.ts":
          'export const label: string = "After dark"; declare global { var __forgecutCompileSentinel: string | undefined; }',
      },
    },
  });
  expect(checked, JSON.stringify(checked)).toMatchObject({
    ok: true,
    value: { ok: true, value: { code: expect.stringContaining("After dark") } },
  });
  expect(Reflect.get(globalThis, "__forgecutCompileSentinel")).toBeUndefined();
  expect(state.snapshot()).toEqual(before);
}, 20000);
it.each([
  [
    "type error",
    'const color: number = "red"; export default function Card(){return <div>{color}</div>}',
    "assignable",
  ],
  [
    "forbidden import",
    'import fs from "node:fs"; export default function Card(){return <div>{String(fs)}</div>}',
    "not approved",
  ],
  ["syntax error", "export default function Card(){ return <div>", "closing"],
])(
  "returns located diagnostics for %s without changing the active project",
  async (_name, source, message) => {
    const state = new AppState();
    const service = new EditingService(state);
    const before = state.snapshot();
    expect(
      await service.execute("check_graphic_source", {
        source: { entry: "main.tsx", files: { "main.tsx": source } },
      }),
    ).toMatchObject({
      ok: true,
      value: {
        ok: false,
        error: {
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              file: "main.tsx",
              line: expect.any(Number),
              message: expect.stringContaining(message),
            }),
          ]),
        },
      },
    });
    expect(state.snapshot()).toEqual(before);
  },
  20000,
);

it.each(["main.js", "main.jsx"])(
  "checks accepted executable workspace file %s",
  async (entry) => {
    const state = new AppState();
    const service = new EditingService(state);
    expect(
      await service.execute("check_graphic_source", {
        source: {
          entry,
          files: {
            [entry]:
              'const color: number = "red"; export default function Card(){return <div>{color}</div>}',
          },
        },
      }),
    ).toMatchObject({
      ok: true,
      value: {
        ok: false,
        error: {
          diagnostics: expect.arrayContaining([
            expect.objectContaining({ file: entry, line: 1 }),
          ]),
        },
      },
    });
  },
  20000,
);
it("rejects unresolved dynamic imports with located diagnostics", async () => {
  const service = new EditingService(new AppState());
  expect(
    await service.execute("check_graphic_source", {
      source: {
        entry: "main.tsx",
        files: {
          "main.tsx":
            "const path=globalThis.location.hash.slice(1); void import(path); export default function Card(){return <div/>}",
        },
      },
    }),
  ).toMatchObject({
    ok: true,
    value: {
      ok: false,
      error: {
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            file: "main.tsx",
            line: 1,
            message: expect.stringContaining("literal"),
          }),
        ]),
      },
    },
  });
}, 20000);

it("enforces the per-file source limit in UTF-8 bytes", async () => {
  const service = new EditingService(new AppState());
  const source = `export default function Card(){return <div>${"界".repeat(50000)}</div>}`;
  const result = await service.execute("check_graphic_source", {
    source: { entry: "main.tsx", files: { "main.tsx": source } },
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
});
