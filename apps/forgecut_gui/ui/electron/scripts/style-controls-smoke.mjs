import { verifyAppearance } from "./appearance-smoke.mjs";

export async function verifyStyleControls(send) {
  const response = await send("Runtime.evaluate", {
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
        const snapshot = await read();
        throw new Error('Style controls timed out: ' + label + ' ' + JSON.stringify({ alerts: [...document.querySelectorAll('[role=alert]')].map(element => element.textContent), title: field('Title')?.value, styleName: field('Style name')?.value, selected: document.querySelector('.clip-selected .clip-label')?.textContent, styles: snapshot.project.style_presets.map(style => ({ name: style.name, title: style.props.title })), revision: snapshot.revision }));
      };
      const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const button = label => [...document.querySelectorAll('button')].find(element => (element.getAttribute('aria-label') === label || element.textContent.trim() === label) && !element.disabled);
      const click = async label => { await wait(() => button(label), label); button(label).click(); await settle(); };
      const field = label => [...document.querySelectorAll('label')].find(element => element.textContent.trim().startsWith(label))?.querySelector('input, textarea, select');
      const set = async (label, value) => {
        await wait(() => field(label), label);
        const element = field(label);
        element.focus();
        if (element.tagName === 'SELECT') element.value = value;
        else Object.getOwnPropertyDescriptor(element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.blur();
        await settle();
      };
      await invoke('create_project');
      await settle();
      await invoke('add_graphic_item', { templateId: 'title-card', trackId: 'ui-style-graphics', timelineStartUs: 0, durationUs: 1000000, props: { title: 'After dark', color: '#8293a4', font_size: 60, entrance_frames: 0 } });
      const source = (await read()).project.timeline.tracks.flatMap(track => track.items).find(item => item.RemotionGraphic).RemotionGraphic;
      await wait(() => [...document.querySelectorAll('.clip-label')].some(element => element.textContent === 'After dark'), 'source card');
      const label = [...document.querySelectorAll('.clip-label')].find(element => element.textContent === 'After dark');
      const clip = label.closest('.clip');
      clip.scrollIntoView({ block: 'nearest' });
      const bounds = clip.getBoundingClientRect();
      label.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: bounds.x + 20, clientY: bounds.y + 10 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await click('Save project style');
      await set('Style name', 'Octane card');
      await click('Create style');
      await wait(async () => (await read()).project.style_presets.length === 1 && !field('Style name'), 'created style');
      const preset = (await read()).project.style_presets[0];
      await invoke('move_clip', { itemId: source.id, newStartUs: 5000000 });
      const picker = document.querySelector('select[aria-label="Graphic template"]');
      picker.value = 'style:' + preset.id;
      picker.dispatchEvent(new Event('change', { bubbles: true }));
      await click('Add graphic');
      await wait(async () => (await read()).project.timeline.tracks.flatMap(track => track.items).filter(item => item.RemotionGraphic).length === 2, 'preset instance');
      const copy = (await read()).project.timeline.tracks.flatMap(track => track.items).find(item => item.RemotionGraphic?.id !== source.id && item.RemotionGraphic).RemotionGraphic;
      if (copy.timeline_start_us !== 0 || copy.props.title !== 'After dark' || copy.props.color !== '#8293a4') throw new Error('Picker instance changed the saved look');
      await set('Title', 'Manual card');
      await wait(async () => (await read()).project.timeline.tracks.flatMap(track => track.items).some(item => item.RemotionGraphic?.id === source.id && item.RemotionGraphic.props.title === 'Manual card') && field('Title')?.value === 'Manual card', 'manual source text');
      await click('Save project style');
      await set('Style destination', preset.id);
      await click('Replace style');
      await wait(async () => (await read()).project.style_presets[0].props.title === 'Manual card' && !field('Style name'), 'replaced style');
      if ((await read()).project.timeline.tracks.flatMap(track => track.items).find(item => item.RemotionGraphic?.id === copy.id).RemotionGraphic.props.title !== 'After dark') throw new Error('Replacing a style changed an existing instance');
      await click('Undo');
      await wait(async () => (await read()).project.style_presets[0].props.title === 'After dark', 'replacement undo');
      await click('Delete style: Octane card');
      await wait(async () => (await read()).project.style_presets.length === 0, 'style deletion');
      await click('Undo');
      await wait(async () => (await read()).project.style_presets.length === 1, 'deletion undo');
      const scroll = document.querySelector('.timeline-scroll');
      const rect = scroll.getBoundingClientRect();
      document.querySelector('.time-ruler').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: rect.x + 48 + 500 - scroll.scrollLeft, clientY: rect.y + 10 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await wait(() => document.querySelector('.preview-time')?.textContent === '00:00:05.000', 'selected source preview');
      const sourceLabel = [...document.querySelectorAll('.clip-label')].find(element => element.textContent === 'Manual card');
      const sourceClip = sourceLabel.closest('.clip');
      sourceClip.scrollIntoView({ block: 'nearest' });
      const sourceBounds = sourceClip.getBoundingClientRect();
      sourceLabel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: sourceBounds.x + 20, clientY: sourceBounds.y + 10 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await settle();
      await click('Save project style');
      await wait(() => field('Style name'), 'style form');
      if (button('Reload style')) await click('Reload style');
      document.querySelector('.inspector-body').scrollTop = 0;
      return true;
    })()`,
  });
  if (
    response.result?.exceptionDetails ||
    response.result?.result?.value !== true
  )
    throw new Error(
      `Style control workflow failed: ${JSON.stringify(response.result)}`,
    );
  await verifyAppearance(send, "canvas");
  const layout = await send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const form = document.querySelector('.graphic-style-form');
      return form && form.scrollWidth <= form.clientWidth + 1 && [...form.querySelectorAll('input, select, button')].every(element => element.scrollWidth <= element.clientWidth + 1);
    })()`,
  });
  if (layout.result?.result?.value !== true)
    throw new Error("Style form controls overflow");
  await send("Runtime.evaluate", {
    awaitPromise: true,
    expression: "window.forgecut.invoke('create_project')",
  });
  console.log(
    "Visual style creation, picker insertion, manual edits, replacement, deletion and undo verified",
  );
}
