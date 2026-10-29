// @vitest-environment node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

test.each(["darwin", "win32"])(
  "%s packaging skips the unsupported native graphics runtime without writing files",
  (platform) => {
    const preload = `import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} });
    fs.mkdir = async () => { throw new Error('Unsupported packaging attempted to write a graphics runtime'); };
    syncBuiltinESMExports();`;
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        `data:text/javascript,${encodeURIComponent(preload)}`,
        resolve("electron/scripts/prepare-graphic-runtime.mjs"),
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
    expect(result.stderr).not.toContain(
      "Unsupported packaging attempted to write a graphics runtime",
    );
    expect(result.status, result.stderr).toBe(0);
  },
);

test("only Linux installers include the isolated graphics runtime", () => {
  const configuration = readFileSync("electron-builder.yml", "utf8");
  const [common, linux] = configuration.split("\nlinux:\n");
  expect(common).not.toContain("from: electron/dist/graphic-runtime");
  expect(linux).toContain("from: electron/dist/graphic-runtime");
});
