import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function verifySourceSelections(directory, send) {
  const path = join(directory, "source-selection.mp4");
  const generated = spawnSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=30:duration=4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    path,
  ]);
  if (generated.status !== 0) throw new Error(generated.stderr.toString());
  const result = await send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const invoke = async (command, args) => {
        const response = await window.forgecut.invoke(command, args);
        if (!response.ok) throw new Error(response.error.message);
        return response.value;
      };
      const read = () => invoke('get_project_snapshot');
      const wait = async (predicate, label) => {
        for (let attempt = 0; attempt < 200; attempt++) {
          if (await predicate()) return;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error('Source selection timed out: ' + label);
      };
      const button = label => [...document.querySelectorAll('button')].find(element => (element.getAttribute('aria-label') === label || element.textContent.trim() === label) && !element.disabled);
      const click = async label => { await wait(() => button(label), label); button(label).click(); };
      const field = label => [...document.querySelectorAll('label')].find(element => element.textContent.trim().startsWith(label))?.querySelector('input, textarea');
      const set = async (label, value) => {
        await wait(() => field(label), label);
        const element = field(label);
        element.focus();
        const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.blur();
      };
      await invoke('create_project');
      await invoke('init_default_tracks');
      const assets = await invoke('import_assets', { paths: [${JSON.stringify(path)}] });
      await click('Review source: ' + assets[0].name);
      await wait(() => document.querySelector('.source-media-stage video')?.readyState >= 2, 'source decoding');
      await set('Source in (s)', '1');
      await set('Source out (s)', '3');
      await click('New selection');
      await wait(async () => (await read()).project.source_selections.length === 1, 'saved range');
      await set('Notes', 'Keep the engine sound');
      await wait(async () => (await read()).project.source_selections[0].notes === 'Keep the engine sound', 'manual note');
      const before = await read();
      await invoke('apply_edits', { sessionId: before.sessionId, expectedRevision: before.revision, requestId: 'native-source-range', operations: [{ command: 'update_source_selection', args: { selectionId: before.project.source_selections[0].id, patch: { source_in_us: 1500000 } } }] });
      await wait(() => field('Source in (s)')?.value === '1.5', 'agent range update');
      if (field('Notes').value !== 'Keep the engine sound') throw new Error('Agent range changed the manual note');
      const timelineBefore = JSON.stringify((await read()).project.timeline);
      await click('Append selection');
      await wait(async () => (await read()).project.timeline.tracks.some(track => track.items.some(item => item.VideoClip)), 'inserted range');
      const clip = (await read()).project.timeline.tracks.flatMap(track => track.items).find(item => item.VideoClip).VideoClip;
      if (clip.source_in_us !== 1500000 || clip.source_out_us !== 3000000 || clip.timeline_start_us !== 0) throw new Error('Appended range changed');
      await click('Undo');
      await wait(async () => JSON.stringify((await read()).project.timeline) === timelineBefore, 'insertion undo');
      await click('Canvas');
      await click('Review source: ' + assets[0].name);
      await wait(() => field('Notes')?.value === 'Keep the engine sound', 'source notes after reopening');
      return true;
    })()`,
  });
  if (result.result?.exceptionDetails || result.result?.result?.value !== true)
    throw new Error(
      `Source selection workflow failed: ${JSON.stringify(result.result)}`,
    );
  for (const width of [1280, 1024]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    for (const mode of ["dark", "light"]) {
      const layout = await send("Runtime.evaluate", {
        awaitPromise: true,
        returnByValue: true,
        expression: `(async () => {
          document.querySelector('button[aria-label="Appearance"]').click();
          await new Promise(resolve => setTimeout(resolve, 50));
          document.querySelector('input[name="appearance-mode"][value="${mode}"]').click();
          document.querySelector('button[aria-label="Close appearance"]').click();
          await new Promise(resolve => setTimeout(resolve, 150));
          const panel = document.querySelector('.source-selection-inspector');
          const stage = document.querySelector('.source-media-stage');
          const controls = [...panel.querySelectorAll('input, textarea, select, button')];
          if (panel.scrollWidth > panel.clientWidth + 1 || controls.some(element => element.scrollWidth > element.clientWidth + 1)) throw new Error('Source controls overflow');
          if (stage.clientWidth < 300 || stage.clientHeight < 150) throw new Error('Source monitor is too small');
          return true;
        })()`,
      });
      if (
        layout.result?.exceptionDetails ||
        layout.result?.result?.value !== true
      )
        throw new Error(
          `Source layout failed: ${JSON.stringify(layout.result)}`,
        );
      if (process.env.FORGECUT_SOURCE_SCREENSHOTS) {
        await mkdir(process.env.FORGECUT_SOURCE_SCREENSHOTS, {
          recursive: true,
        });
        const shot = await send("Page.captureScreenshot", { format: "png" });
        await writeFile(
          join(
            process.env.FORGECUT_SOURCE_SCREENSHOTS,
            `source-${width}-${mode}.png`,
          ),
          Buffer.from(shot.result.data, "base64"),
        );
      }
    }
  }
  await send("Emulation.clearDeviceMetricsOverride");
  await send("Runtime.evaluate", {
    awaitPromise: true,
    expression: "window.forgecut.invoke('create_project')",
  });
  console.log(
    "Source decoding, saved ranges, manual notes, agent patches, timeline insertion and undo verified",
  );
}
