// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("packaging generates update metadata for ForgeCut's fixed public release feed", () => {
  const configuration = readFileSync("electron-builder.yml", "utf8");
  expect(configuration).toMatch(
    /publish:\s+provider: github\s+owner: alexanderwanyoike\s+repo: forgecut\s+releaseType: draft/,
  );
});
test("release artifacts include updater metadata and keep new releases in draft", () => {
  const workflow = readFileSync(
    "../../../.github/workflows/package.yml",
    "utf8",
  );
  expect(workflow).toContain("dist-installers/latest*.yml");
  expect(workflow).toContain("dist-installers/*.blockmap");
  expect(workflow).toContain("draft: true");
});
