import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { bundle } from '@remotion/bundler';
import { ensureBrowser } from '@remotion/renderer';

const require = createRequire(import.meta.url);
const runtime = resolve('results/runtime');
await mkdir(runtime, { recursive: true });
const browser = await ensureBrowser({ logLevel: 'error' });
if (!('path' in browser)) throw new Error(`Browser preparation failed: ${browser.type}`);
await cp(dirname(browser.path), resolve(runtime, 'browser'), { recursive: true });
await cp(dirname(require.resolve('@remotion/compositor-linux-x64-gnu/package.json')), resolve(runtime, 'compositor'), { recursive: true });
await cp(require.resolve('@esbuild/linux-x64/bin/esbuild'), resolve(runtime, 'esbuild'));
await bundle({ entryPoint: resolve('src/render-entry.tsx'), publicDir: resolve('public'), outDir: resolve(runtime, 'composition') });
const compiled = await build({ entryPoints: ['render-worker.mjs'], outfile: resolve(runtime, 'worker.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node20', metafile: true, external: ['bufferutil', 'utf-8-validate'], banner: { js: 'const __forgecutImportMetaUrl = require("node:url").pathToFileURL(__filename).href;' }, define: { 'import.meta.url': '__forgecutImportMetaUrl' } });
const packages = new Map();
async function packageAt(file) {
  let folder = dirname(resolve(file));
  while (folder !== dirname(folder)) {
    try {
      const pkg = JSON.parse(await readFile(resolve(folder, 'package.json'), 'utf8'));
      if (pkg.name && pkg.version) return { folder, pkg };
    } catch {}
    folder = dirname(folder);
  }
  throw new Error(`Cannot locate dependency metadata for ${file}`);
}
for (const input of Object.keys(compiled.metafile.inputs)) {
  if (!input.includes('node_modules/')) continue;
  const entry = await packageAt(input);
  packages.set(`${entry.pkg.name}@${entry.pkg.version}`, entry);
}
for (const name of ['react', 'react-dom', 'scheduler', 'remotion', '@remotion/player', 'monaco-editor', '@modelcontextprotocol/client', '@modelcontextprotocol/server', '@remotion/compositor-linux-x64-gnu']) {
  const entry = await packageAt(require.resolve(name));
  packages.set(`${entry.pkg.name}@${entry.pkg.version}`, entry);
}
let notices = '# Evaluation runtime dependency notices\n\nPreserve the upstream terms for each dependency. This is a local evaluation artifact.\n';
const manifest = [];
for (const [id, { folder, pkg }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  manifest.push({ name: pkg.name, version: pkg.version, license: pkg.license ?? 'See upstream notices', repository: pkg.repository });
  notices += `\n## ${id}\n\nDeclared licence: ${pkg.license ?? 'See upstream notices'}.\n`;
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.txt', 'NOTICE', 'ThirdPartyNotices.txt']) {
    try { notices += `\n${name}\n\n${await readFile(resolve(folder, name), 'utf8')}\n`; } catch {}
  }
}
notices += '\n## Native FFmpeg distribution\n\n' + execFileSync(resolve(runtime, 'compositor/ffmpeg'), ['-L'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
notices += '\nUpstream source and build scripts: https://github.com/remotion-dev/rust-ffmpeg-splitter\n';
notices += '\n## Evaluation font\n\n' + await readFile(process.env.FORGECUT_CHECK_FONT_LICENSE ?? '/usr/share/doc/fonts-dejavu-core/copyright', 'utf8');
await writeFile(resolve(runtime, 'THIRD_PARTY_NOTICES.md'), notices);
await writeFile(resolve(runtime, 'dependencies.json'), JSON.stringify(manifest, null, 2));
const browserExecutable = `browser/${browser.path.split('/').at(-1)}`;
const digests = {};
for (const file of [browserExecutable, 'compositor/remotion', 'compositor/ffmpeg', 'esbuild', 'worker.cjs']) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(resolve(runtime, file))) hash.update(chunk);
  digests[file] = hash.digest('hex');
}
await writeFile(resolve(runtime, 'runtime.json'), JSON.stringify({ remotion: '4.0.537', browserExecutable, browserVersion: execFileSync(browser.path, ['--version'], { encoding: 'utf8' }).trim(), platform: process.platform, arch: process.arch, sha256: digests }, null, 2));
console.log('Prepared the packaged compiler, browser, compositor, graphics and notices.');
