import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function verifyCredits(directory, send) {
  const artwork = join(directory, "credit-artwork.png");
  const projectPath = join(directory, "credits.forgecut");
  await writeFile(
    artwork,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const evaluated = async (expression) => {
    const response = await send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression,
    });
    if (
      response.result?.exceptionDetails ||
      response.result?.result?.value !== true
    )
      throw new Error(
        `Project credits failed: ${JSON.stringify(response.result)}`,
      );
  };
  const helpers = `
    const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const invoke = async (command, args) => { const response = await window.forgecut.invoke(command, args); if (!response.ok) throw new Error(response.error.message); await settle(); return response.value; };
    const read = () => invoke('get_project_snapshot');
    const wait = async (predicate, label) => { for (let i = 0; i < 200; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error('Credits timed out: ' + label); };
    const button = label => [...document.querySelectorAll('button')].find(element => (element.getAttribute('aria-label') === label || element.textContent.trim() === label) && !element.disabled);
    const click = async label => { await wait(() => button(label), label); button(label).click(); await settle(); };
    const field = label => [...document.querySelectorAll('.credits-dialog label')].find(element => element.firstChild?.textContent.trim() === label)?.querySelector('input, textarea, select');
    const set = async (label, value) => { await wait(() => field(label), label); const element = field(label); const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); await settle(); };
    const openCredits = async () => { button('File').focus(); await click('File'); await click('Project credits'); await wait(() => document.querySelector('.credits-dialog')?.matches(':modal'), 'modal'); };
  `;
  await evaluated(`(async () => { ${helpers}
    await invoke('create_project');
    await invoke('init_default_tracks');
    const assets = await invoke('import_assets', { paths: [${JSON.stringify(join(directory, "source-selection.mp4"))}] });
    await invoke('import_graphic_resource', { path: ${JSON.stringify(artwork)}, kind: 'Image', license: { identifier: 'Fixture artwork', text: 'Generated test image' } });
    await invoke('add_text_overlay', { trackId: 'credit-title', timelineStartUs: 0, durationUs: 1000000, text: 'Credits fixture', fontSize: 24, color: '#ffffff', x: 20, y: 20 });
    const selected = (await read()).project.timeline.tracks.flatMap(track => track.items).find(item => item.TextOverlay).TextOverlay.id;
    await invoke('set_editing_context', { sessionId: (await read()).sessionId, selectedItemIds: [selected], playheadUs: 500000 });
    await openCredits();
    await set('Licence / permission', 'Original recording');
    await set('Attribution', 'Project editor');
    await set('Licence notice', 'Recorded for the project');
    await click('Save credits');
    await wait(async () => (await read()).project.assets[0].license?.attribution === 'Project editor', 'saved recording credit');
    await set('Attribution', 'Manual draft');
    await invoke('set_asset_license', { assetId: assets[0].id, license: { identifier: 'Agent metadata', text: 'Agent notice', attribution: 'Agent credit' } });
    await wait(() => document.querySelector('.credit-conflict'), 'concurrent credit');
    if (field('Attribution').value !== 'Manual draft' || button('Save credits')) throw new Error('Concurrent credit overwrote the draft or enabled saving');
    await click('Reload credits');
    await set('Attribution', 'Reviewed credit');
    await click('Save credits');
    await wait(async () => (await read()).project.assets[0].license?.attribution === 'Reviewed credit', 'reviewed credit');
    await click('Remove credit');
    await wait(async () => !(await read()).project.assets[0].license, 'removed credit');
    await invoke('undo');
    await wait(async () => (await read()).project.assets[0].license?.attribution === 'Reviewed credit', 'credit undo');
    const resource = (await read()).project.resources[0];
    await set('Credit for', resource.id);
    await set('Attribution', 'Artwork designer');
    await click('Save credits');
    await wait(async () => (await read()).project.resources[0].license.attribution === 'Artwork designer', 'artwork attribution');
    const saved = (await read()).project;
    if (saved.resources[0].sha256 !== resource.sha256 || saved.resources[0].license.text !== 'Generated test image') throw new Error('Credit changed artwork identity or notice');
    await invoke('save_project', { path: ${JSON.stringify(projectPath)} });
    await invoke('load_project', { path: ${JSON.stringify(projectPath)} });
    if (JSON.stringify((await read()).project) !== JSON.stringify(saved)) throw new Error('Credits changed after reopening');
    return true;
  })()`);
  for (const width of [1280, 1024]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    for (const mode of ["dark", "light"]) {
      await evaluated(`(async () => { ${helpers}
        if (document.querySelector('.credits-dialog')) await click('Close project credits');
        await click('Appearance');
        document.querySelector('input[name="appearance-mode"][value="${mode}"]').click();
        await click('Close appearance');
        await openCredits();
        await set('Credit for', (await read()).project.resources[0].id);
        const dialog = document.querySelector('.credits-dialog');
        const rect = dialog.getBoundingClientRect();
        if (rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight || dialog.scrollWidth > dialog.clientWidth + 1) throw new Error('Credit dialog exceeds the viewport');
        if ([...dialog.querySelectorAll('input, textarea, select, button')].some(element => element.scrollWidth > element.clientWidth + 1)) throw new Error('Credit control overflows');
        if (!dialog.contains(document.activeElement)) throw new Error('Modal did not receive keyboard focus');
        button('Close project credits').focus(); await settle();
        await wait(() => dialog.querySelector('[role="tooltip"]'), 'close tooltip in modal');
        if (field('Attribution').value !== 'Artwork designer') throw new Error('Saved artwork credit is missing');
        return true;
      })()`);
      if (process.env.FORGECUT_CREDIT_SCREENSHOTS) {
        await mkdir(process.env.FORGECUT_CREDIT_SCREENSHOTS, {
          recursive: true,
        });
        const shot = await send("Page.captureScreenshot", { format: "png" });
        await writeFile(
          join(
            process.env.FORGECUT_CREDIT_SCREENSHOTS,
            `credits-${mode}-${width}.png`,
          ),
          Buffer.from(shot.result.data, "base64"),
        );
      }
    }
  }
  await evaluated(
    `(async () => { ${helpers} window.creditKeyboardProject = JSON.stringify((await read()).project); button('Close project credits').focus(); return true; })()`,
  );
  for (const [key, code, windowsVirtualKeyCode] of [
    ["Delete", "Delete", 46],
    ["s", "KeyS", 83],
    ["Backspace", "Backspace", 8],
  ]) {
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code,
      windowsVirtualKeyCode,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code,
      windowsVirtualKeyCode,
    });
    await evaluated(
      `(async () => { ${helpers} if (JSON.stringify((await read()).project) !== window.creditKeyboardProject) throw new Error('Modal key edited the underlying timeline'); return true; })()`,
    );
  }
  for (let index = 0; index < 10; index += 1) {
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
    });
    await evaluated(
      `document.querySelector('.credits-dialog').contains(document.activeElement)`,
    );
  }
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await evaluated(
    `(async () => { ${helpers} await wait(() => !document.querySelector('.credits-dialog'), 'Escape dismissal'); await invoke('create_project'); return true; })()`,
  );
  await send("Emulation.clearDeviceMetricsOverride");
  console.log(
    "Visual recording/artwork credits, concurrent drafts, global undo, reopen, modal keyboard navigation and themed layouts verified",
  );
}
