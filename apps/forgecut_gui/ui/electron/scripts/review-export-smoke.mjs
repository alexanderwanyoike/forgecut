import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function verifyReviewExports(directory, send) {
  const outputPath = join(directory, "review-range.mp4");
  const helpers = `
    const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const invoke = async (command, args) => { const response = await window.forgecut.invoke(command, args); if (!response.ok) throw new Error(response.error.message); await settle(); return response.value; };
    const read = () => invoke('get_project_snapshot');
    const wait = async (predicate, label) => { for (let i = 0; i < 400; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error('Review export timed out: ' + label); };
    const button = (label, root = document) => [...root.querySelectorAll('button')].find(element => (element.getAttribute('aria-label') === label || element.textContent.trim() === label) && !element.disabled);
    const click = async (label, root) => { await wait(() => button(label, root), label); button(label, root).click(); await settle(); };
    const dialog = () => document.querySelector('[role="dialog"][aria-labelledby="export-heading"]');
    const set = async (label, value) => { const input = [...dialog().querySelectorAll('label')].find(element => element.firstChild?.textContent.trim() === label)?.querySelector('input'); if (!input) throw new Error('Missing ' + label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); await settle(); };
    const openRange = async () => { await click('Export', document.querySelector('.menu-bar')); await wait(dialog, 'dialog'); dialog().querySelector('input[type="checkbox"]').click(); await settle(); await set('Review end (s)', '1.85'); };
  `;
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (
      result.result?.exceptionDetails ||
      result.result?.result?.value !== true
    )
      throw new Error(`Review export failed: ${JSON.stringify(result.result)}`);
  };
  await evaluate(`(async () => { ${helpers}
    await invoke('create_project');
    await invoke('update_project', { settings: { width: 64, height: 36, fps: 10 } });
    await invoke('init_default_tracks');
    const assets = await invoke('import_assets', { paths: [${JSON.stringify(join(directory, "source-selection.mp4"))}] });
    const snapshot = await read();
    const track = snapshot.project.timeline.tracks.find(track => track.kind === 'Video');
    await invoke('add_clip_to_timeline', { assetId: assets[0].id, trackId: track.id, timelineStartUs: 0 });
    const scroll = document.querySelector('.timeline-scroll');
    const bounds = scroll.getBoundingClientRect();
    const position = { bubbles: true, button: 0, clientX: bounds.x + 48 + 125 - scroll.scrollLeft, clientY: bounds.y + 10 };
    document.querySelector('.time-ruler').dispatchEvent(new MouseEvent('mousedown', position));
    window.dispatchEvent(new MouseEvent('mouseup', position));
    await wait(() => document.querySelector('.preview-time')?.textContent === '00:00:01.250', 'visible playhead');
    await openRange();
    const start = [...dialog().querySelectorAll('label')].find(element => element.firstChild?.textContent.trim() === 'Review start (s)').querySelector('input');
    if (start.value !== '1.25' || !button('Export', dialog())) throw new Error('Review controls did not capture the visible playhead or accept the range');
    const format = dialog().querySelector('select');
    format.value = 'webm';
    format.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    if (format.value !== 'webm') throw new Error('WebM preset was not selected');
    await click('Close export dialog', dialog());
    const before = await read();
    const job = await invoke('export_project', { outputPath: ${JSON.stringify(outputPath)}, sequenceId: before.project.default_sequence.id, range: { startUs: 1250000, endUs: 1850000 } });
    await wait(async () => { const current = await invoke('get_media_job', { sessionId: job.sessionId, jobId: job.id }); if (current.status === 'failed' || current.status === 'cancelled') throw new Error(JSON.stringify(current.result)); return current.status === 'completed'; }, 'output');
    const webm = await invoke('export_project', { outputPath: ${JSON.stringify(join(directory, "review-range.webm"))}, preset: 'webm', sequenceId: before.project.default_sequence.id, range: { startUs: 1250000, endUs: 1850000 } });
    await wait(async () => { const current = await invoke('get_media_job', { sessionId: webm.sessionId, jobId: webm.id }); if (current.status === 'failed' || current.status === 'cancelled') throw new Error(JSON.stringify(current.result)); return current.status === 'completed'; }, 'WebM output');
    if (JSON.stringify((await read()).project) !== JSON.stringify(before.project)) throw new Error('Review export changed the creative project');
    return true;
  })()`);
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-count_frames",
      "-show_entries",
      "stream=nb_read_frames",
      "-of",
      "csv=p=0",
      outputPath,
    ],
    { encoding: "utf8" },
  );
  if (probe.status !== 0 || Number(probe.stdout.trim()) !== 6)
    throw new Error(
      `Review output has incorrect frame count: ${probe.stdout} ${probe.stderr}`,
    );
  const webmProbe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-count_frames",
      "-show_entries",
      "stream=codec_name,nb_read_frames",
      "-of",
      "json",
      join(directory, "review-range.webm"),
    ],
    { encoding: "utf8" },
  );
  if (webmProbe.status !== 0) throw new Error(webmProbe.stderr);
  const streams = JSON.parse(webmProbe.stdout).streams;
  if (
    !streams.some(
      (stream) => stream.codec_name === "vp9" && stream.nb_read_frames === "6",
    ) ||
    !streams.some((stream) => stream.codec_name === "opus")
  )
    throw new Error("WebM export has incorrect codecs or frame count");
  for (const width of [1280, 1024]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    for (const mode of ["dark", "light"]) {
      await evaluate(`(async () => { ${helpers}
        await click('Appearance'); document.querySelector('input[name="appearance-mode"][value="${mode}"]').click(); await click('Close appearance');
        await openRange();
        const bounds = dialog().getBoundingClientRect();
        if (bounds.left < 0 || bounds.right > innerWidth || bounds.top < 0 || bounds.bottom > innerHeight || dialog().scrollWidth > dialog().clientWidth + 1) throw new Error('Review export dialog exceeds its viewport');
        if ([...dialog().querySelectorAll('input, button')].some(element => element.scrollWidth > element.clientWidth + 1)) throw new Error('Review export control overflows');
        return true;
      })()`);
      if (process.env.FORGECUT_REVIEW_SCREENSHOTS) {
        await mkdir(process.env.FORGECUT_REVIEW_SCREENSHOTS, {
          recursive: true,
        });
        const screenshot = await send("Page.captureScreenshot", {
          format: "png",
        });
        await writeFile(
          join(
            process.env.FORGECUT_REVIEW_SCREENSHOTS,
            `review-export-${mode}-${width}.png`,
          ),
          Buffer.from(screenshot.result.data, "base64"),
        );
      }
      await evaluate(
        `(async () => { ${helpers} await click('Close export dialog', dialog()); return true; })()`,
      );
    }
  }
  await send("Emulation.clearDeviceMetricsOverride");
  await evaluate(
    `(async () => { ${helpers} await invoke('create_project'); return true; })()`,
  );
  console.log(
    "Native review-range controls, format picker, MP4/WebM six-frame exports, unchanged project and themed layouts verified",
  );
}
