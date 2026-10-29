import { build } from "esbuild";
import { dirname, join, resolve } from "node:path";
import { readFile, readdir, writeFile } from "node:fs/promises";

const projectRoot = resolve(import.meta.dirname, "../..");
const bundle = await build({
  absWorkingDir: projectRoot,
  entryPoints: ["electron/mcp/stdio.ts"],
  outfile: "electron/dist/mcp-adapter.cjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  metafile: true,
  legalComments: "inline",
});

const packages = new Map();
for (const input of Object.keys(bundle.metafile.inputs)) {
  if (!input.includes("node_modules/")) continue;
  let directory = dirname(resolve(projectRoot, input));
  while (directory.startsWith(projectRoot)) {
    try {
      const metadata = JSON.parse(
        await readFile(join(directory, "package.json"), "utf8"),
      );
      if (metadata.name) {
        packages.set(directory, metadata);
        break;
      }
    } catch {}
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
}
const notices = ["ForgeCut MCP adapter: bundled third-party notices\n"];
for (const [directory, metadata] of [...packages].sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  notices.push(
    `${metadata.name} ${metadata.version}\nLicence: ${metadata.license ?? "See upstream terms"}\n`,
  );
  const files = (await readdir(directory, { withFileTypes: true })).filter(
    (entry) =>
      entry.isFile() &&
      /^(licen[cs]e|notice|copying|copyright)([.-]|$)/i.test(entry.name),
  );
  if (files.length === 0)
    throw new Error(`Missing bundled licence text: ${metadata.name}`);
  for (const file of files)
    notices.push(await readFile(join(directory, file.name), "utf8"));
}
await writeFile(
  join(projectRoot, "electron/dist/mcp-notices.txt"),
  notices.join("\n\n"),
);
