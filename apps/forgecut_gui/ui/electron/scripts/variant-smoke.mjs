export async function verifyVariants(send) {
  const response = await send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const read = async () => {
        const response = await window.forgecut.invoke('get_project_snapshot');
        if (!response.ok) throw new Error(response.error.message);
        return response.value;
      };
      const before = await read();
      const root = before.project.default_sequence.id;
      const invoke = async (command, args, sequenceId) => {
        const response = await window.forgecut.invoke(command, args, { sessionId: before.sessionId, sequenceId });
        if (!response.ok) throw new Error(response.error.message);
        return response.value;
      };
      const wait = async (predicate, label) => {
        for (let attempt = 0; attempt < 200; attempt++) {
          if (await predicate()) return;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error('Variant editor timed out: ' + label);
      };
      const button = label => [...document.querySelectorAll('button')].find(element => (element.getAttribute('aria-label') === label || element.textContent.trim() === label) && !element.disabled);
      const click = async label => { await wait(() => button(label), label); button(label).click(); };
      const set = (element, value) => {
        element.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.blur();
      };
      const field = label => [...document.querySelectorAll('label')].find(element => element.textContent.trim().startsWith(label))?.querySelector('input');
      await invoke('add_text_overlay', { trackId: 'variant-native-title', timelineStartUs: 0, durationUs: 1000000, text: 'Variant source', fontSize: 24, color: '#ffffff', x: 20, y: 20 }, root);
      const source = (await read()).project.timeline.tracks.flatMap(track => track.items).find(item => item.TextOverlay?.text === 'Variant source').TextOverlay;
      await click('Create sequence variant');
      await wait(() => document.querySelector('input[aria-label="Sequence name"]'), 'variant form');
      set(document.querySelector('input[aria-label="Sequence name"]'), 'Native portrait variant');
      const format = [...document.querySelectorAll('label')].find(element => element.textContent.includes('Variant format')).querySelector('select');
      format.value = 'portrait';
      format.dispatchEvent(new Event('change', { bubbles: true }));
      await click('Create variant');
      await wait(async () => (await read()).project.sequences.some(sequence => sequence.name === 'Native portrait variant'), 'copied sequence');
      const variant = (await read()).project.sequences.find(sequence => sequence.name === 'Native portrait variant');
      await wait(() => document.querySelector('select[aria-label="Active sequence"]')?.value === variant.id && document.querySelector('.preview-composition')?.style.width === '1080px', 'portrait viewport');
      if (variant.settings.height !== 1920 || variant.variant_source.sequence_id !== root) throw new Error('Variant settings or source identity changed');
      const copied = variant.timeline.tracks.flatMap(track => track.items).find(item => item.TextOverlay?.origin_item_id === source.id).TextOverlay;
      if (copied.id === source.id || copied.track_id === source.track_id) throw new Error('Variant identities were reused');
      const label = [...document.querySelectorAll('.clip-label')].find(element => element.textContent === 'Variant source');
      const clip = label.closest('.clip');
      clip.scrollIntoView({ block: 'nearest' });
      const bounds = clip.getBoundingClientRect();
      label.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: bounds.x + 20, clientY: bounds.y + 10 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await wait(() => field('Text'), 'variant text inspector');
      set(field('Text'), 'Manual variant wording');
      await wait(async () => (await read()).project.sequences.find(sequence => sequence.id === variant.id).timeline.tracks.flatMap(track => track.items).some(item => item.TextOverlay?.text === 'Manual variant wording'), 'manual variant edit');
      await invoke('move_clip', { itemId: source.id, newStartUs: 500000 }, root);
      const sourceEdited = JSON.stringify((await read()).project.timeline);
      await click('Sync timing');
      await wait(async () => (await read()).project.sequences.find(sequence => sequence.id === variant.id).timeline.tracks.flatMap(track => track.items).some(item => item.TextOverlay?.id === copied.id && item.TextOverlay.timeline_start_us === 500000), 'explicit timing sync');
      const synced = (await read()).project.sequences.find(sequence => sequence.id === variant.id).timeline.tracks.flatMap(track => track.items).find(item => item.TextOverlay?.id === copied.id).TextOverlay;
      if (synced.text !== 'Manual variant wording' || JSON.stringify((await read()).project.timeline) !== sourceEdited) throw new Error('Timing sync changed wording or source edits');
      await click('Undo');
      await wait(async () => (await read()).project.sequences.find(sequence => sequence.id === variant.id).timeline.tracks.flatMap(track => track.items).some(item => item.TextOverlay?.id === copied.id && item.TextOverlay.timeline_start_us === 0), 'timing undo');
      for (let index = 0; index < 8; index++) {
        const current = await read();
        if (JSON.stringify(current.project) === JSON.stringify(before.project)) break;
        await invoke('undo', undefined, current.undoSequenceId);
      }
      if (JSON.stringify((await read()).project) !== JSON.stringify(before.project)) throw new Error('Variant workflow cleanup did not restore the project');
      return true;
    })()`,
  });
  if (
    response.result?.exceptionDetails ||
    response.result?.result?.value !== true
  )
    throw new Error(
      `Variant workflow failed: ${JSON.stringify(response.result)}`,
    );
  console.log(
    "Portrait variant creation, manual wording, explicit timing sync and undo verified",
  );
}
