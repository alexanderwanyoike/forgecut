import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const result = spawnSync(
  process.execPath,
  [
    resolve(root, "node_modules/vitest/vitest.mjs"),
    "run",
    "electron/backend/__tests__/graphics-export.test.ts",
    "electron/backend/__tests__/graphics-worker-process.test.ts",
    "electron/backend/__tests__/graphic-isolation.test.ts",
    "electron/backend/__tests__/custom-graphics-export.test.ts",
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, FORGECUT_GRAPHICS_TEST: "1" },
  },
);
process.exitCode = result.status ?? 1;
