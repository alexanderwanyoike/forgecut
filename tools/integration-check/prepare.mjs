import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

await mkdir('public', { recursive: true });
await mkdir('results', { recursive: true });
await copyFile(
  process.env.FORGECUT_CHECK_FONT ?? '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  'public/check-font.ttf',
);
await writeFile('public/check-image.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="8" fill="#70a08b"/></svg>');
execFileSync('ffmpeg', ['-v', 'error', '-threads', '1', '-filter_threads', '1', '-f', 'lavfi', '-i', 'color=c=0x24292c:s=640x360:r=60:d=1', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', 'public/check-source.mkv']);
execFileSync('ffmpeg', ['-v', 'error', '-i', 'public/check-source.mkv', '-c', 'copy', '-y', 'public/check-source.mp4']);
