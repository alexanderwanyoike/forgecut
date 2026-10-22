import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, protocol } from 'electron';
import { verifyPackagedRuntime } from './packaged-check.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, 'dist');
const results = process.env.FORGECUT_CHECK_RESULTS ?? resolve(root, 'results');
protocol.registerSchemesAsPrivileged(['forgecut-check', 'forgecut-code'].map((scheme) => ({ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } })));
app.commandLine.appendSwitch('disable-gpu');

async function main() {
  const timeout = setTimeout(() => { console.error('Integration check timed out'); app.exit(1); }, 45_000);
  await app.whenReady();
  console.log('Electron ready');
  protocol.handle('forgecut-check', async (request) => {
    const path = resolve(dist, `.${decodeURIComponent(new URL(request.url).pathname)}`);
    if (!path.startsWith(`${dist}${sep}`)) return new Response(null, { status: 403 });
    const mime = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.html') ? 'text/html' : path.endsWith('.svg') ? 'image/svg+xml' : path.endsWith('.mkv') ? 'video/x-matroska' : path.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream';
    try { return new Response(await readFile(path), { headers: { 'Content-Type': mime } }); }
    catch { return new Response(null, { status: 404 }); }
  });
  const win = new BrowserWindow({ show: false, width: 720, height: 720, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) { errors.push(message); console.error(message); } });
  await win.loadURL('forgecut-check://app/index.html');
  console.log('Built fixture loaded');
  const result = await win.webContents.executeJavaScript(`(async () => {
    while (!window.integrationCheck) await new Promise(resolve => setTimeout(resolve, 50));
    return window.integrationCheck.verify();
  })()`);
  const media = await win.webContents.executeJavaScript(`(async () => {
    const check = (name) => new Promise(resolve => {
      const video = document.createElement('video');
      video.muted = true;
      const finish = (supported) => { clearTimeout(timer); video.pause(); video.removeAttribute('src'); video.load(); resolve(supported); };
      const timer = setTimeout(() => finish(false), 5_000);
      video.onerror = () => finish(false);
      video.onloadeddata = async () => { try { await video.play(); finish(true); } catch { finish(false); } };
      video.src = new URL('/' + name, location.href).href;
      video.load();
    });
    return { h264AacMkv: await check('check-source.mkv'), h264AacMp4: await check('check-source.mp4') };
  })()`);
  assert.equal(media.h264AacMp4, true, 'MP4 playback failed');
  assert.deepEqual(errors, [], 'Renderer errors');
  const image = await win.webContents.capturePage();
  await writeFile(resolve(results, 'preview.png'), image.toPNG());
  const report = { ...result, ...media, builtAssets: true, developmentServer: false, appPackaged: app.isPackaged, electronWorkingSetKiB: app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0) };
  await writeFile(resolve(results, 'electron.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
  if (process.argv.includes('--phase0')) {
    clearTimeout(timeout);
    const phaseTimeout = setTimeout(() => { console.error('Packaged checks timed out'); app.exit(1); }, 120_000);
    await verifyPackagedRuntime({ results, dist, editor: win });
    clearTimeout(phaseTimeout);
  }
  clearTimeout(timeout);
  win.destroy();
  app.exit(0);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
