/** @vitest-environment node */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { importGraphicResource } from "../graphic-resource-import";
import { graphicResourceResponse } from "../graphic-resource-response";
import { resourceStorePath } from "../graphic-resource-store";

afterEach(() => vi.unstubAllEnvs());
it("serves only a current project's hash-checked resources", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "forgecut-resource-response-"),
  );
  try {
    vi.stubEnv("FORGECUT_RESOURCE_DIR", join(directory, "cache"));
    const path = join(directory, "font.ttf");
    const bytes = Buffer.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    await writeFile(path, bytes);
    const imported = await importGraphicResource(path, "Font", {
      identifier: "test-only",
      text: "Generated transport fixture",
    });
    if (!imported.ok) throw new Error(imported.error.message);
    const resource = imported.value;
    const url = `forgecut-resource://resource/${resource.sha256}`;
    expect((await graphicResourceResponse([], url)).status).toBe(403);
    const response = await graphicResourceResponse([resource], url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("font/ttf");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    await writeFile(resourceStorePath(resource.sha256), "changed font");
    expect((await graphicResourceResponse([resource], url)).status).toBe(404);
    expect(
      (
        await graphicResourceResponse(
          [resource],
          "forgecut-resource://resource/../secret",
        )
      ).status,
    ).toBe(400);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
