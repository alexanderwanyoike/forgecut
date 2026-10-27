import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function verifyBatchControls(directory, send) {
  const output = join(directory, "visual-batch");
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.result?.exceptionDetails)
      throw new Error(`Batch controls failed: ${JSON.stringify(result.result)}`);
    return result.result?.result?.value;
  };
  const helpers = `
    const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const invoke = async (command, args, metadata) => { const result = await window.forgecut.invoke(command, args, metadata); if (!result.ok) throw new Error(result.error.message); await settle(); return result.value; };
    const wait = async (predicate, label) => { for (let attempt = 0; attempt < 600; attempt++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error('Batch controls timed out: ' + label); };
    const button = label => [...document.querySelectorAll('button')].find(element => (element.getAttribute('aria-label') === label || element.textContent.trim() === label) && !element.disabled);
    const click = async label => { await wait(() => button(label), label); button(label).click(); await settle(); };
    const dialog = () => document.querySelector('.batch-dialog:modal');
    const openBatch = async () => { await click('File'); await click('Batch exports'); await wait(dialog, 'modal'); };
  `;
  await evaluate(`(async () => { ${helpers}
    await invoke('create_project');
    await invoke('init_default_tracks');
    await invoke('update_project', { name: 'Channel edits', settings: { width: 32, height: 18, fps: 10 } });
    await invoke('set_sequence_end', { endUs: 200000 });
    await invoke('create_sequence', { name: 'Portrait clip', settings: { width: 18, height: 32 } });
    const captured = await invoke('get_project_snapshot');
    await invoke('set_sequence_end', { endUs: 200000 }, { sequenceId: captured.project.sequences[0].id });
    localStorage.removeItem('forgecut.exportBatchDirectory');
    await openBatch();
    const folder = [...dialog().querySelectorAll('label')].find(element => element.firstChild?.textContent.trim() === 'Batch folder').querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(folder, ${JSON.stringify(output)});
    folder.dispatchEvent(new Event('input', { bubbles: true }));
    folder.dispatchEvent(new Event('change', { bubbles: true }));
    const format = dialog().querySelector('select');
    format.value = 'webm';
    format.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    return true;
  })()`);
  const shots = process.env.FORGECUT_BATCH_SCREENSHOTS;
  for (const [width, height] of [[1280, 800], [1024, 768]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    for (const mode of ["dark", "light"]) {
      await evaluate(`(async () => { document.documentElement.dataset.theme = '${mode}'; await document.fonts.ready; await new Promise(resolve => setTimeout(resolve, 100)); return true; })()`);
      const layout = await evaluate(`(() => {
        const dialog = document.querySelector('.batch-dialog');
        const bounds = dialog.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && dialog.scrollWidth <= dialog.clientWidth;
      })()`);
      if (!layout) throw new Error(`Batch dialog overflowed at ${width}px`);
      if (shots) {
        await mkdir(shots, { recursive: true });
        const screenshot = await send("Page.captureScreenshot", { format: "png" });
        await writeFile(join(shots, `batch-create-${mode}-${width}.png`), Buffer.from(screenshot.result.data, "base64"));
      }
    }
  }
  const entries = await evaluate(`(async () => { ${helpers}
    const before = JSON.stringify((await invoke('get_project_snapshot')).project);
    await click('Create and export');
    await wait(() => dialog()?.textContent.includes('2 / 2 complete'), 'completed outputs');
    if (JSON.stringify((await invoke('get_project_snapshot')).project) !== before) throw new Error('Visual batch changed the project');
    await click('Close batch exports');
    await openBatch();
    await wait(() => dialog()?.textContent.includes('2 / 2 complete'), 'reopened completed batch');
    if (button('Resume batch') || button('Retry unfinished exports') || button('Pause batch')) throw new Error('Reopening restarted completed exports');
    const saved = await invoke('get_export_batch', { directory: ${JSON.stringify(output)} });
    if (saved.active) throw new Error('Read-only reopen started a render');
    await click('Close batch exports');
    await invoke('create_project');
    return saved.entries;
  })()`);
  for (const [index, entry] of entries.entries()) {
    const result = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,nb_read_frames", "-of", "json", join(output, entry.outputFile)], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    const stream = JSON.parse(result.stdout).streams[0];
    if (stream.codec_name !== "vp9" || stream.width !== (index ? 18 : 32) || stream.height !== (index ? 32 : 18) || stream.nb_read_frames !== "2") throw new Error(`Incorrect visual batch output: ${JSON.stringify(stream)}`);
  }
  console.log("Visual batch creation, two actual exports, unchanged project, read-only reopening and responsive themes verified");
}
