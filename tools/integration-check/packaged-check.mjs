import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { app, BrowserWindow, session } from 'electron';

const bounded = (promise, milliseconds, message) => {
  let timer;
  return Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]).finally(() => clearTimeout(timer));
};

export async function verifyPackagedRuntime({ results, dist, editor }) {
  assert(app.isPackaged, 'Run this check from the packaged executable');
  const hostSentinel = resolve(tmpdir(), `forgecut-host-secret-${randomUUID()}`);
  await writeFile(hostSentinel, 'fixture secret outside the job');
  let hostRequests = 0;
  const hostServer = createServer((_req, res) => { hostRequests++; res.end('fixture secret'); });
  await new Promise((resolve) => hostServer.listen(0, '127.0.0.1', resolve));
  const hostProbeUrl = `http://127.0.0.1:${hostServer.address().port}/secret`;
  const packageRoot = dirname(process.execPath);
  const report = { appPackaged: true, jobs: [] };

  async function job(mode, source, timeoutMs = 30_000) {
    const work = await mkdtemp(resolve(results, 'job-'));
    await writeFile(resolve(work, 'job.json'), JSON.stringify({ mode, source, hostSentinel, hostProbeUrl }));
    const args = [
      '--unshare-all', '--new-session', '--die-with-parent', '--cap-drop', 'ALL', '--clearenv',
      '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64', '/lib64',
      '--dir', '/etc', '--ro-bind', '/etc/ld.so.cache', '/etc/ld.so.cache', '--ro-bind', '/etc/fonts', '/etc/fonts',
      '--ro-bind', '/etc/alternatives', '/etc/alternatives',
      '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
      '--ro-bind', packageRoot, '/app', '--bind', work, '/work', '--chdir', '/work',
      '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'ELECTRON_RUN_AS_NODE', '1',
      '--setenv', 'ESBUILD_BINARY_PATH', '/app/resources/runtime/esbuild',
      '--setenv', 'NODE_OPTIONS', '--max-old-space-size=1536',
      `/app/${basename(process.execPath)}`, '/app/resources/runtime/worker.cjs',
    ];
    const child = spawn('/usr/bin/bwrap', args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', FORGECUT_ISOLATION_SECRET: 'fixture environment secret' } });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => { output = (output + data.toString()).slice(-16_384); });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, timeoutMs);
    let code;
    try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); }
    finally { clearTimeout(timer); }
    await writeFile(resolve(work, 'worker.log'), output);
    return { work, code, timedOut, output };
  }

  let codeWindow;
  try {
    const rendered = await job('render');
    assert.equal(rendered.code, 0, rendered.output);
    report.jobs.push(JSON.parse(await readFile(resolve(rendered.work, 'result.json'), 'utf8')));
    console.log('Packaged browser, compositor and FFmpeg render passed');

    const probeSource = `import React from 'react';
      export default function Probe() {
        const [state, setState] = React.useState(null);
        React.useEffect(() => {
          let nodeBlocked = false;
          try { require('node:fs'); } catch { nodeBlocked = true; }
          Promise.all([${JSON.stringify(hostProbeUrl)}, ${JSON.stringify(`file://${hostSentinel}`)}].map(url => fetch(url).then(() => false, () => true)))
            .then(([networkBlocked, fileBlocked]) => setState({ nodeBlocked, bridgeBlocked: !window.forgecut, networkBlocked, fileBlocked }));
        }, []);
        return <div data-probe>{state ? JSON.stringify(state) : 'pending'}</div>;
      }`;
    const compiled = await job('compile', probeSource);
    assert.equal(compiled.code, 0, compiled.output);
    const { compiledCode } = JSON.parse(await readFile(resolve(compiled.work, 'compiled.json'), 'utf8'));
    const codeSession = session.fromPartition(`code-check-${randomUUID()}`);
    const csp = "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    codeSession.protocol.handle('forgecut-code', async (request) => {
      const path = resolve(dist, `.${decodeURIComponent(new URL(request.url).pathname)}`);
      if (!path.startsWith(`${dist}${sep}`)) return new Response(null, { status: 403 });
      const mime = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html';
      try { return new Response(await readFile(path), { headers: { 'Content-Type': mime, 'Content-Security-Policy': csp } }); }
      catch { return new Response(null, { status: 404 }); }
    });
    codeSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('forgecut-code://component/') }));
    codeSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    codeSession.on('will-download', (event) => event.preventDefault());
    codeWindow = new BrowserWindow({ show: false, webPreferences: { session: codeSession, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, webviewTag: false } });
    codeWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    codeWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    await codeWindow.loadURL('forgecut-code://component/sandbox.html');
    await bounded(codeWindow.webContents.executeJavaScript(`(async () => {
      while (!window.componentCheck) await new Promise(resolve => setTimeout(resolve, 20));
      window.componentCheck.mount(${JSON.stringify(compiledCode)});
      while (!document.querySelector('[data-probe]')?.textContent.startsWith('{')) await new Promise(resolve => setTimeout(resolve, 20));
      return JSON.parse(document.querySelector('[data-probe]').textContent);
    })()`), 10_000, 'Sandbox component did not respond').then((probe) => {
      assert.deepEqual(probe, { nodeBlocked: true, bridgeBlocked: true, networkBlocked: true, fileBlocked: true });
      report.previewIsolation = probe;
    });
    assert.equal(hostRequests, 0, 'Component accessed a host service');
    console.log('Compiled component preview isolation passed');

    const source = `import React from 'react'; export default () => <div style={{color: '#70a08b', fontSize: 32}}>Custom title</div>`;
    const custom = await job('still', source);
    assert.equal(custom.code, 0, custom.output);
    report.jobs.push(JSON.parse(await readFile(resolve(custom.work, 'result.json'), 'utf8')));

    const rejected = await job('still', `import fs from 'node:fs'; export default function Bad() { return fs.readFileSync('/etc/passwd'); }`);
    assert.notEqual(rejected.code, 0, 'Unsupported Node import executed');
    assert.match(rejected.output, /Unsupported component import/);
    report.unsupportedImportRejected = true;

    const loop = await job('compile', `while (true) {} export default () => null;`);
    assert.equal(loop.code, 0, loop.output);
    const loopCode = JSON.parse(await readFile(resolve(loop.work, 'compiled.json'), 'utf8')).compiledCode;
    await assert.rejects(bounded(codeWindow.webContents.executeJavaScript(`window.componentCheck.mount(${JSON.stringify(loopCode)})`), 1000, 'Component deadline'), /Component deadline/);
    codeWindow.webContents.forcefullyCrashRenderer();
    codeWindow.destroy();
    codeWindow = null;
    assert.equal(await editor.webContents.executeJavaScript("document.querySelector('[data-title]').textContent"), 'Your build');
    report.previewHangTerminated = true;
    report.editorSurvived = true;

    const hung = await job('still', 'while (true) {} export default () => null;', 6_000);
    assert(hung.timedOut, 'Unresponsive export was not terminated');
    const recovery = await job('still', source);
    assert.equal(recovery.code, 0, recovery.output);
    report.exportHangTerminated = true;
    report.renderRecovered = true;
    assert.equal(hostRequests, 0);
    await writeFile(resolve(results, 'phase0.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    if (codeWindow && !codeWindow.isDestroyed()) codeWindow.destroy();
    hostServer.close();
    await rm(hostSentinel, { force: true });
  }
}
