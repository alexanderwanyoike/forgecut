import { build } from "esbuild";
import { createRequire } from "node:module";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const runtime = join(root, "electron/dist/code-runtime");
const require = createRequire(import.meta.url);
await mkdir(runtime, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ["electron/source/worker.ts"],
  outfile: join(runtime, "compiler.cjs"),
  bundle: true,
  external: ["esbuild"],
  platform: "node",
  target: "node20",
  format: "cjs",
  legalComments: "inline",
  banner: {
    js: 'const __forgecutImportMetaUrl = require("node:url").pathToFileURL(__filename).href;',
  },
  define: { "import.meta.url": "__forgecutImportMetaUrl" },
});
const binary = process.platform === "win32" ? "esbuild.exe" : "bin/esbuild";
await cp(
  require.resolve(`@esbuild/${process.platform}-${process.arch}/${binary}`),
  join(runtime, process.platform === "win32" ? "esbuild.exe" : "esbuild"),
);
const libraries = {};
const notices = [];
async function collect(folder, virtual) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    const name = `${virtual}/${entry.name}`;
    if (entry.isDirectory()) await collect(path, name);
    else if (
      entry.isFile() &&
      (entry.name.endsWith(".d.ts") || entry.name === "package.json")
    )
      libraries[name] = await readFile(path, "utf8");
  }
}
for (const name of [
  "typescript",
  "@types/react",
  "@types/prop-types",
  "csstype",
  "remotion",
  "@remotion/fonts",
]) {
  const folder = dirname(require.resolve(`${name}/package.json`));
  await collect(
    folder,
    name === "typescript"
      ? "/forgecut/typescript"
      : `/forgecut/node_modules/${name}`,
  );
  const metadata = JSON.parse(
    await readFile(join(folder, "package.json"), "utf8"),
  );
  notices.push(
    `${name} ${metadata.version}\nLicence: ${metadata.license ?? "See upstream terms"}`,
  );
  const texts = (await readdir(folder)).filter((file) =>
    /^(licen[cs]e|notice|copyright)([.-]|$)/i.test(file),
  );
  for (const file of texts)
    notices.push(await readFile(join(folder, file), "utf8"));
}
const esbuildFolder = dirname(require.resolve("esbuild/package.json"));
await mkdir(join(runtime, "node_modules/esbuild/lib"), { recursive: true });
for (const name of ["package.json", "lib/main.js", "LICENSE.md"])
  await cp(
    join(esbuildFolder, name),
    join(runtime, "node_modules/esbuild", name),
  );
notices.push(
  "esbuild: MIT",
  await readFile(join(esbuildFolder, "LICENSE.md"), "utf8"),
);
await writeFile(join(runtime, "types.json"), JSON.stringify(libraries));
await writeFile(join(runtime, "THIRD_PARTY_NOTICES.txt"), notices.join("\n\n"));
console.log(
  "Prepared the offline source compiler and approved type libraries.",
);
