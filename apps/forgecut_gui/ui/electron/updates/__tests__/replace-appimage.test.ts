// @vitest-environment node
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { replaceAppImage } from "../replace-appimage";

test("atomically replaces the existing AppImage path and preserves it on a missing download", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-update-"));
  try {
    const installed = join(directory, "ForgeCut 1.0.1.AppImage");
    const downloaded = join(directory, "1.1.0.AppImage");
    await writeFile(installed, "old", { mode: 0o755 });
    expect((await replaceAppImage(installed, downloaded)).ok).toBe(false);
    expect(await readFile(installed, "utf8")).toBe("old");
    await writeFile(downloaded, "new");
    expect((await replaceAppImage(installed, downloaded)).ok).toBe(true);
    expect(await readFile(installed, "utf8")).toBe("new");
    if (process.platform !== "win32")
      expect((await stat(installed)).mode % 0o1000).toBe(0o755);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
