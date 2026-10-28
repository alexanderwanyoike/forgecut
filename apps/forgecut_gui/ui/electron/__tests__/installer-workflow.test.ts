// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";

test.skipIf(process.platform !== "linux").each([
  ["pull_request", "main", "README.md", "true"],
  ["pull_request", "dev", "README.md", "false"],
  ["pull_request", "dev", "apps/forgecut_gui/ui/package.json", "true"],
  ["workflow_dispatch", "", "README.md", "true"],
])(
  "installer decision for %s into %s changing %s is %s",
  async (event, branch, file, expected) => {
    const workflow = await readFile(
      "../../../.github/workflows/package.yml",
      "utf8",
    );
    const section = workflow
      .split("      - id: decide")[1]
      .split("  package:")[0];
    const script = section
      .split("        run: |\n")[1]
      .replace(/^          /gm, "");
    const directory = await mkdtemp(join(tmpdir(), "forgecut-installer-ci-"));
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        [
          "-c",
          "user.name=ForgeCut test",
          "-c",
          "user.email=test@example.invalid",
          "-c",
          "commit.gpgsign=false",
          "-c",
          `core.hooksPath=${join(directory, "no-hooks")}`,
          ...args,
        ],
        { cwd: directory, encoding: "utf8" },
      );
    try {
      git("init", "--quiet");
      git("commit", "--quiet", "--allow-empty", "-m", "baseline");
      const base = git("rev-parse", "HEAD").trim();
      await mkdir(dirname(join(directory, file)), { recursive: true });
      await writeFile(join(directory, file), "fixture");
      git("add", ".");
      git("commit", "--quiet", "-m", "change");
      execFileSync("bash", ["-e", "-c", script], {
        cwd: directory,
        env: {
          ...process.env,
          EVENT_NAME: event,
          BASE_BRANCH: branch,
          BASE_SHA: base,
          GITHUB_OUTPUT: "decision.txt",
        },
      });
      expect(
        (await readFile(join(directory, "decision.txt"), "utf8")).trim(),
      ).toBe(`build=${expected}`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
