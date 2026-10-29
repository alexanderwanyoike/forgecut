import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export async function verifyProjectCollection(directory, send) {
  const source = join(directory, "collection-source.mp4");
  const externalName =
    "external-recording-kept-outside-this-portable-collection-and-available-for-later-relinking.mp4";
  const external = join(directory, externalName);
  const original = join(directory, "collected-project");
  const moved = join(directory, "moved-collection");
  const output = join(directory, "collected-output.mp4");
  await copyFile(join(directory, "source-selection.mp4"), source);
  await copyFile(source, external);
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (
      response.result?.exceptionDetails ||
      response.result?.result?.value !== true
    )
      throw new Error(
        `Project collection failed: ${JSON.stringify(response.result)}`,
      );
  };
  const helpers = `
    const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const invoke = async (command, args) => { const response = await window.forgecut.invoke(command, args); if (!response.ok) throw new Error(response.error.message); await settle(); return response.value; };
    const wait = async (predicate, label) => { for (let attempt = 0; attempt < 400; attempt++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error('Collection controls timed out: ' + label); };
    const button = (label, root = document) => [...root.querySelectorAll('button')].find(element => (element.getAttribute('aria-label') === label || element.textContent.trim() === label) && !element.disabled);
    const click = async (label, root) => { await wait(() => button(label, root), label); button(label, root).click(); await settle(); };
    const dialog = () => document.querySelector('.collection-dialog:modal');
    const waitJob = async job => { for (let attempt = 0; attempt < 400; attempt++) { const current = await invoke('get_media_job', { sessionId: job.sessionId, jobId: job.id }); if (current.status === 'completed') return current; if (['failed', 'cancelled'].includes(current.status)) throw new Error(JSON.stringify(current.result)); await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error('Collection job timed out'); };
  `;
  await evaluate(`(async () => { ${helpers}
    await invoke('create_project');
    await invoke('init_default_tracks');
    await invoke('update_project', { name: 'Captured collection', settings: { width: 32, height: 18, fps: 10 } });
    const assets = await invoke('import_assets', { paths: [${JSON.stringify(source)}, ${JSON.stringify(external)}] });
    const snapshot = await invoke('get_project_snapshot');
    const track = snapshot.project.timeline.tracks.find(track => track.kind === 'Video');
    await invoke('add_clip_to_timeline', { assetId: assets[0].id, trackId: track.id, timelineStartUs: 0 });
    await invoke('set_sequence_end', { endUs: 200000 });
    await click('File');
    await click('Collect project');
    await wait(dialog, 'modal');
    const unchecked = dialog().querySelector('input[aria-label="Include ${externalName}"]');
    if (!unchecked?.checked) throw new Error('External recording was not available');
    unchecked.click();
    const folder = [...dialog().querySelectorAll('label')].find(element => element.firstChild?.textContent.trim() === 'Collection folder').querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(folder, ${JSON.stringify(original)});
    folder.dispatchEvent(new Event('input', { bubbles: true }));
    folder.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    return true;
  })()`);
  async function capture(stage) {
    for (const [width, height] of [
      [1280, 800],
      [1024, 768],
    ]) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      for (const mode of ["dark", "light"]) {
        await evaluate(`(async () => {
          document.documentElement.dataset.theme = '${mode}';
          await document.fonts.ready;
          await new Promise(resolve => setTimeout(resolve, 100));
          const dialog = document.querySelector('.collection-dialog');
          const bounds = dialog.getBoundingClientRect();
          if (bounds.left < 0 || bounds.right > innerWidth || bounds.top < 0 || bounds.bottom > innerHeight || dialog.scrollWidth > dialog.clientWidth) throw new Error('Collection controls overflowed');
          return true;
        })()`);
        const shots = process.env.FORGECUT_COLLECTION_SCREENSHOTS;
        if (shots) {
          await mkdir(shots, { recursive: true });
          const screenshot = await send("Page.captureScreenshot", {
            format: "png",
          });
          await writeFile(
            join(shots, `collection-${stage}-${mode}-${width}.png`),
            Buffer.from(screenshot.result.data, "base64"),
          );
        }
      }
    }
  }
  await capture("choose");
  await evaluate(`(async () => { ${helpers}
    await click('Collect project', dialog());
    await wait(() => dialog()?.querySelector('[role="status"]'), 'accepted job');
    await invoke('update_project', { name: 'Manual edit after capture' });
    const before = JSON.stringify((await invoke('get_project_snapshot')).project);
    await wait(() => dialog()?.textContent.includes('Collection ready'), 'completed collection');
    if (JSON.stringify((await invoke('get_project_snapshot')).project) !== before) throw new Error('Visual collection changed manual edits');
    return true;
  })()`);
  await capture("ready");
  const saved = JSON.parse(
    await readFile(join(original, "project.forgecut"), "utf8"),
  );
  if (
    saved.assets.length !== 2 ||
    isAbsolute(saved.assets[0].path) ||
    saved.assets[1].path !== external
  )
    throw new Error(
      "Visual selection did not preserve local/external media choices",
    );
  await evaluate(`(async () => { ${helpers}
    await click('Close project collection', dialog());
    await invoke('create_project');
    return true;
  })()`);
  await rename(original, moved);
  await rm(source);
  await evaluate(`(async () => { ${helpers}
    await invoke('load_project', { path: ${JSON.stringify(join(moved, "project.forgecut"))} });
    const snapshot = await invoke('get_project_snapshot');
    if (snapshot.missingMedia.length || snapshot.project.name !== 'Captured collection') throw new Error('Moved collection lost its captured revision or media');
    await waitJob(await invoke('export_project', { outputPath: ${JSON.stringify(output)} }));
    await invoke('create_project');
    return true;
  })()`);
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-count_frames",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=nb_read_frames",
      "-of",
      "csv=p=0",
      output,
    ],
    { encoding: "utf8" },
  );
  if (probe.status !== 0 || probe.stdout.trim() !== "2")
    throw new Error(`Collected export failed: ${probe.stdout} ${probe.stderr}`);
  console.log(
    "Visual collection selection, unchanged manual edits, responsive themes, moved reopening without the original selected source and actual export verified",
  );
}
