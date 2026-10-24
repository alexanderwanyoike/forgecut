import { writeFile } from "node:fs/promises";

export async function verifySequences(send) {
  const response = await send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const invoke = async (command, args) => {
        const result = await window.forgecut.invoke(command, args);
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      };
      const snapshot = () => invoke('get_project_snapshot');
      const wait = async (predicate, label) => {
        for (let attempt = 0; attempt < 200; attempt++) {
          if (await predicate()) return;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error('Sequence editor timed out: ' + label);
      };
      const click = async (label) => {
        await wait(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === label && !button.disabled), label);
        [...document.querySelectorAll('button')].find(button => button.textContent.trim() === label && !button.disabled).click();
      };
      const input = (label) => document.querySelector('input[aria-label="' + label + '"]') ??
        [...document.querySelectorAll('label')].find(element => element.querySelector('.inspector-label')?.textContent.trim() === label)?.querySelector('input');
      const setInput = async (label, value) => {
        await wait(() => input(label), label);
        const element = input(label);
        element.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.blur();
      };
      const select = (id) => {
        const picker = document.querySelector('select[aria-label="Active sequence"]');
        picker.value = id;
        picker.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const before = await snapshot();
      const root = before.project.default_sequence.id;
      const rootContext = await invoke('get_editing_context');
      await click('New sequence');
      await setInput('Sequence name', 'Portrait smoke');
      await click('Create sequence');
      await wait(async () => (await snapshot()).project.sequences.some(sequence => sequence.name === 'Portrait smoke'), 'created sequence');
      const clip = (await snapshot()).project.sequences.find(sequence => sequence.name === 'Portrait smoke').id;
      await wait(() => document.querySelector('select[aria-label="Active sequence"]')?.value === clip && document.querySelector('.inspector-body')?.textContent.includes('Project Settings'), 'active empty sequence');
      await setInput('Width', '360');
      await wait(async () => (await snapshot()).project.sequences.find(sequence => sequence.id === clip).settings.width === 360, 'portrait width');
      await setInput('Height', '640');
      await wait(async () => (await snapshot()).project.sequences.find(sequence => sequence.id === clip).settings.height === 640, 'portrait height');
      await click('+ Text');
      await wait(() => document.querySelector('.clip-label')?.textContent === 'Hello World', 'sequence title');
      const item = (await snapshot()).project.sequences.find(sequence => sequence.id === clip).timeline.tracks.flatMap(track => track.items).find(item => item.TextOverlay).TextOverlay;
      const context = await window.forgecut.invoke('set_editing_context', { sessionId: before.sessionId, sequenceId: clip, selectedItemIds: [item.id], playheadUs: 250000 });
      if (!context.ok) throw new Error(context.error.message);
      select(root);
      await wait(() => document.querySelector('select[aria-label="Active sequence"]')?.value === root && document.querySelector('.preview-composition')?.style.width === before.project.settings.width + 'px', 'default sequence');
      const restored = await invoke('get_editing_context');
      if (restored.playheadUs !== rootContext.playheadUs || JSON.stringify(restored.selectedItemIds) !== JSON.stringify(rootContext.selectedItemIds)) throw new Error('Default sequence context was overwritten');
      select(clip);
      await wait(() => document.querySelector('.preview-composition')?.style.width === '360px' && document.querySelector('.preview-time')?.textContent === '00:00:00.250', 'portrait context restored');
      await setInput('Text', 'Portrait');
      await wait(async () => (await snapshot()).project.sequences.find(sequence => sequence.id === clip).timeline.tracks.flatMap(track => track.items).some(item => item.TextOverlay?.text === 'Portrait'), 'manual title edit');
      await click('Rename sequence');
      await setInput('Sequence name', 'Portrait review');
      await click('Save sequence name');
      await wait(() => document.querySelector('select[aria-label="Active sequence"] option:checked')?.textContent === 'Portrait review', 'renamed sequence');
      const changed = await snapshot();
      if (JSON.stringify(changed.project.timeline) !== JSON.stringify(before.project.timeline)) throw new Error('Sequence edits changed the default timeline');
      window.__forgecutSequenceSmoke = { beforeDelete: changed.project, clip };
      return { clip, root, width: 360, height: 640 };
    })()`,
  });
  if (response.result?.exceptionDetails || !response.result?.result?.value)
    throw new Error(
      `Sequence workflow failed: ${JSON.stringify(response.result)}`,
    );
  if (process.env.FORGECUT_SEQUENCE_SCREENSHOT) {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(
      process.env.FORGECUT_SEQUENCE_SCREENSHOT,
      Buffer.from(shot.result.data, "base64"),
    );
  }
  const deleted = await send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const wait = async predicate => {
        for (let attempt = 0; attempt < 200; attempt++) {
          if (await predicate()) return;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error('Sequence deletion or undo did not finish');
      };
      const snapshot = async () => (await window.forgecut.invoke('get_project_snapshot')).value;
      const click = label => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === label && !button.disabled).click();
      click('Delete sequence');
      await wait(async () => (await snapshot()).project.sequences.length === 0);
      await wait(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Undo' && !button.disabled));
      click('Undo');
      await wait(async () => (await snapshot()).project.sequences.length === 1);
      if (JSON.stringify((await snapshot()).project) !== JSON.stringify(window.__forgecutSequenceSmoke.beforeDelete)) throw new Error('Sequence deletion did not undo exactly');
      const result = await window.forgecut.invoke('delete_sequence', { sequenceId: window.__forgecutSequenceSmoke.clip });
      if (!result.ok) throw new Error(result.error.message);
      delete window.__forgecutSequenceSmoke;
      return true;
    })()`,
  });
  if (
    deleted.result?.exceptionDetails ||
    deleted.result?.result?.value !== true
  )
    throw new Error(`Sequence undo failed: ${JSON.stringify(deleted.result)}`);
  console.log(
    "Named sequence controls, portrait editing, context restoration and deletion undo verified",
  );
}
