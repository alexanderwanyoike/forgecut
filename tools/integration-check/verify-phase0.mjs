import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('The Phase 0 packaged isolation fixture currently targets Linux x64');
const root = dirname(fileURLToPath(import.meta.url));
const scratch = await mkdtemp(resolve(tmpdir(), 'forgecut-packaged-cwd-'));
await mkdir(resolve(root, 'results'), { recursive: true });
try {
  const child = spawn('xvfb-run', ['--auto-servernum', resolve(root, 'results/package/linux-unpacked/forgecut-integration-check'), '--phase0'], {
    cwd: scratch,
    env: { ...process.env, FORGECUT_CHECK_RESULTS: resolve(root, 'results') },
    stdio: 'inherit',
  });
  process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code) => resolve(code ?? 1)); });
} finally {
  await rm(scratch, { recursive: true, force: true });
}
