import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const [label, command, ...args] = process.argv.slice(2);
if (!label || !/^[a-z-]+$/.test(label) || !command) throw new Error('Expected a label and command');
const child = spawn(command, args, { stdio: 'inherit' });
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
const group = (await readFile('/proc/self/cgroup', 'utf8')).trim().split(':').at(-1);
const read = async (name) => (await readFile(`/sys/fs/cgroup${group}/${name}`, 'utf8')).trim();
const report = { memoryPeakBytes: Number(await read('memory.peak')), memoryMaxBytes: await read('memory.max'), memoryHighBytes: await read('memory.high'), cpuMax: await read('cpu.max'), exitCode: code };
await writeFile(`results/resources-${label}.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
process.exitCode = code ?? 1;
