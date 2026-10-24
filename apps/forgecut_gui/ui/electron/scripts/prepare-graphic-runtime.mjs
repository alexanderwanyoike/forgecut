import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { bundle } from "@remotion/bundler";
import { ensureBrowser } from "@remotion/renderer";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");
const runtime = resolve(root, "electron/dist/graphic-runtime");
await mkdir(runtime, { recursive: true });
const browser = await ensureBrowser({ logLevel: "error" });
if (!("path" in browser))
  throw new Error(`Browser preparation failed: ${browser.type}`);
await rm(resolve(runtime, "browser"), { recursive: true, force: true });
await cp(dirname(browser.path), resolve(runtime, "browser"), {
  recursive: true,
});
const suffix =
  process.platform === "win32"
    ? "-msvc"
    : process.platform === "linux"
      ? process.report.getReport().header.glibcVersionRuntime
        ? "-gnu"
        : "-musl"
      : "";
const compositor = `@remotion/compositor-${process.platform}-${process.arch}${suffix}`;
await rm(resolve(runtime, "compositor"), { recursive: true, force: true });
await cp(
  dirname(require.resolve(`${compositor}/package.json`)),
  resolve(runtime, "compositor"),
  { recursive: true },
);
await bundle({
  entryPoint: resolve(root, "electron/graphics/RenderEntry.tsx"),
  outDir: resolve(runtime, "composition"),
  publicDir: null,
});
const compiled = await build({
  absWorkingDir: root,
  entryPoints: ["electron/backend/graphic-worker.ts"],
  outfile: resolve(runtime, "worker.cjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  legalComments: "inline",
  metafile: true,
  external: ["bufferutil", "utf-8-validate"],
  banner: {
    js: 'const __forgecutImportMetaUrl = require("node:url").pathToFileURL(__filename).href;',
  },
  define: { "import.meta.url": "__forgecutImportMetaUrl" },
});
const packages = new Map();
for (const input of [
  ...Object.keys(compiled.metafile.inputs),
  ...[
    "react",
    "react-dom",
    "scheduler",
    "remotion",
    "@remotion/player",
    "@remotion/fonts",
    compositor,
  ].map((name) => relative(root, require.resolve(name))),
]) {
  if (!input.includes("node_modules/")) continue;
  let folder = dirname(resolve(root, input));
  while (folder !== dirname(folder)) {
    try {
      const pkg = JSON.parse(
        await readFile(resolve(folder, "package.json"), "utf8"),
      );
      if (pkg.name) {
        packages.set(folder, pkg);
        break;
      }
    } catch {}
    folder = dirname(folder);
  }
}
const notices = [
  "ForgeCut graphics runtime: bundled dependency notices. Preserve applicable upstream terms, including Remotion's distribution terms.\n",
];
for (const [folder, pkg] of [...packages].sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  notices.push(
    `${pkg.name} ${pkg.version}\nDeclared licence: ${pkg.license ?? "See upstream terms"}`,
  );
  const files = (await readdir(folder)).filter((name) =>
    /^(licen[cs]e|notice|copying|copyright)([.-]|$)/i.test(name),
  );
  for (const name of files)
    notices.push(await readFile(resolve(folder, name), "utf8"));
}
notices.push(
  "Remotion native compositor/FFmpeg sources and build scripts: https://github.com/remotion-dev/rust-ffmpeg-splitter . Chromium's bundled notices remain alongside its executable.",
);
notices.push(
  execFileSync(
    resolve(
      runtime,
      "compositor",
      process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
    ),
    ["-L"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ),
);
await writeFile(
  resolve(runtime, "THIRD_PARTY_NOTICES.txt"),
  notices.join("\n\n"),
);
await writeFile(
  resolve(runtime, "runtime.json"),
  JSON.stringify(
    {
      remotion: "4.0.537",
      titleSourceHash: createHash("sha256")
        .update(
          await readFile(resolve(root, "electron/graphics/TitleCard.tsx")),
        )
        .digest("hex"),
      platform: process.platform,
      arch: process.arch,
      browserExecutable: `browser/${relative(dirname(browser.path), browser.path).replaceAll("\\", "/")}`,
    },
    null,
    2,
  ),
);
console.log("Prepared the offline graphics runtime, browser and compositor.");
