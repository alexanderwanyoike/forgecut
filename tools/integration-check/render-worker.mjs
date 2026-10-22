import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { transform } from 'esbuild';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';

async function main() {
  const runtime = __dirname;
  const job = JSON.parse(await readFile('/work/job.json', 'utf8'));
  const metadata = JSON.parse(await readFile(resolve(runtime, 'runtime.json'), 'utf8'));
  process.env.ESBUILD_BINARY_PATH = resolve(runtime, 'esbuild');
  const probe = { hostFileHidden: !existsSync(job.hostSentinel), environmentHidden: !process.env.FORGECUT_ISOLATION_SECRET };
  try { await fetch(job.hostProbeUrl, { signal: AbortSignal.timeout(1000) }); probe.hostNetworkHidden = false; }
  catch { probe.hostNetworkHidden = true; }
  assert(probe.hostFileHidden && probe.environmentHidden && probe.hostNetworkHidden, 'Render process escaped its declared resources');
  let compiledCode;
  if (job.source) compiledCode = (await transform(job.source, { loader: 'tsx', format: 'cjs', jsx: 'transform', target: 'es2022' })).code;
  if (job.mode === 'compile') {
    await writeFile('/work/compiled.json', JSON.stringify({ compiledCode, ...probe }));
    return;
  }
  const common = {
    serveUrl: resolve(runtime, 'composition'),
    browserExecutable: resolve(runtime, metadata.browserExecutable),
    binariesDirectory: resolve(runtime, 'compositor'),
    chromiumOptions: { gl: 'swangle', disableWebSecurity: false },
    envVariables: {},
    inputProps: compiledCode ? { compiledCode } : { title: 'Your build', accent: '#70a08b' },
    logLevel: 'error',
    timeoutInMilliseconds: 10_000,
  };
  const composition = await selectComposition({ ...common, id: compiledCode ? 'UserGraphic' : 'CheckGraphic' });
  await renderStill({ ...common, composition, frame: 15, imageFormat: 'png', output: '/work/graphic.png' });
  if (job.mode === 'render') {
    await renderMedia({ ...common, composition, codec: 'prores', proResProfile: '4444', pixelFormat: 'yuva444p10le', imageFormat: 'png', concurrency: 1, outputLocation: '/work/graphic.mov' });
    const ffmpeg = '/usr/bin/ffmpeg';
    execFileSync(ffmpeg, ['-v', 'error', '-threads', '1', '-f', 'lavfi', '-i', 'color=c=0x24292c:s=640x360:r=30:d=1', '-i', '/work/graphic.mov', '-filter_complex_threads', '1', '-filter_complex', '[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]', '-map', '[v]', '-an', '-c:v', 'libx264', '-threads', '1', '-y', '/work/composite.mp4']);
    const media = JSON.parse(execFileSync(resolve(runtime, 'compositor/ffprobe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', '/work/composite.mp4'], { encoding: 'utf8' }));
    assert.equal(Number(media.streams[0].nb_frames), 30);
    assert.equal(Number(media.format.duration), 1);
  }
  await writeFile('/work/result.json', JSON.stringify({ ...probe, compiledSource: Boolean(compiledCode), packagedBrowser: metadata.browserVersion, packagedRemotionBinaries: true, assemblyFfmpeg: '/usr/bin/ffmpeg', mode: job.mode }));
}

main().then(() => process.exit(0)).catch(async (error) => {
  await writeFile('/work/error.json', JSON.stringify({ message: String(error) })).catch(() => {});
  console.error(error);
  process.exit(1);
});
