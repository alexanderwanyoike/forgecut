/** @vitest-environment node */
import { mkdtemp, mkdir, writeFile, rm, symlink, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, expect, it } from "vitest";
import { appAssetResponse } from "../app-assets";
let directory: string;
let root: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "forgecut-app-assets-"));
  root = join(directory, "dist");
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, "index.html"), "<main>ForgeCut</main>");
  await writeFile(
    join(root, "assets", "worker.js"),
    "self.postMessage('ready')",
  );
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
it("serves the packaged index and worker with MIME and a restricted worker-capable CSP", async () => {
  const page = await appAssetResponse(root, "forgecut-app://editor/");
  expect(page.status).toBe(200);
  expect(await page.text()).toBe("<main>ForgeCut</main>");
  expect(page.headers.get("Content-Type")).toContain("text/html");
  expect(page.headers.get("Content-Security-Policy")).toContain(
    "worker-src 'self' blob:",
  );
  expect(page.headers.get("Content-Security-Policy")).toContain(
    "frame-src 'none'",
  );
  expect(page.headers.get("Content-Security-Policy")).toMatch(
    /img-src[^;]*forgecut-media:/,
  );
  const worker = await appAssetResponse(
    root,
    "forgecut-app://editor/assets/worker.js",
  );
  expect(worker.status).toBe(200);
  expect(worker.headers.get("Content-Type")).toContain("javascript");
  expect(await worker.text()).toContain("postMessage");
});
it("rejects other origins malformed paths unsupported files and oversized assets", async () => {
  expect(
    (await appAssetResponse(root, "https://editor/index.html")).status,
  ).toBe(400);
  expect(
    (await appAssetResponse(root, "forgecut-app://other/index.html")).status,
  ).toBe(400);
  expect(
    (await appAssetResponse(root, "forgecut-app://editor/%00.js")).status,
  ).toBe(400);
  expect(
    (await appAssetResponse(root, "forgecut-app://editor/%2Fetc/passwd.js"))
      .status,
  ).toBe(403);
  expect(
    (await appAssetResponse(root, "forgecut-app://editor/assets/missing.js"))
      .status,
  ).toBe(404);
  await writeFile(join(root, "secret.forgecut"), "private");
  expect(
    (await appAssetResponse(root, "forgecut-app://editor/secret.forgecut"))
      .status,
  ).toBe(404);
  const file = await open(join(root, "assets", "large.js"), "w");
  await file.truncate(32 * 1024 * 1024 + 1);
  await file.close();
  expect(
    (await appAssetResponse(root, "forgecut-app://editor/assets/large.js"))
      .status,
  ).toBe(413);
});
it.skipIf(process.platform === "win32")(
  "rejects a built-asset symlink that escapes the app directory",
  async () => {
    await writeFile(join(directory, "outside.js"), "private host content");
    await symlink(
      join(directory, "outside.js"),
      join(root, "assets", "escape.js"),
    );
    expect(
      (await appAssetResponse(root, "forgecut-app://editor/assets/escape.js"))
        .status,
    ).toBe(403);
  },
);
