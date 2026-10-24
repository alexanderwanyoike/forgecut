import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function verifyAppearance(send, state) {
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.result?.exceptionDetails)
      throw new Error(JSON.stringify(response.result.exceptionDetails));
    return response.result?.result?.value;
  };
  const settle = () =>
    evaluate(`(async () => {
    await document.fonts.ready;
    await new Promise(resolve => setTimeout(resolve, 160));
    return true;
  })()`);
  const click = async (label) => {
    const found = await evaluate(`(() => {
      const button = document.querySelector('button[aria-label="${label}"]');
      if (!button || button.disabled) return false;
      button.click(); return true;
    })()`);
    if (!found) throw new Error(`Appearance control unavailable: ${label}`);
    await settle();
  };
  const choose = async (mode, accent) => {
    await click("Appearance");
    await evaluate(`(() => {
      document.querySelector('input[name="appearance-mode"][value="${mode}"]').click();
      document.querySelector('input[name="appearance-accent"][value="${accent}"]').click();
      return true;
    })()`);
    await click("Close appearance");
    await evaluate(`document.activeElement?.blur()`);
  };
  await send("DOM.enable");
  await send("CSS.enable");
  const dom = await send("DOM.getDocument");
  const target = await send("DOM.querySelector", {
    nodeId: dom.result.root.nodeId,
    selector: state === "empty" ? ".canvas-empty strong" : ".app-brand span",
  });
  const fonts = await send("CSS.getPlatformFontsForNode", {
    nodeId: target.result.nodeId,
  });
  console.log("Native interface font:", JSON.stringify(fonts.result.fonts));
  if (
    !fonts.result.fonts.some(
      (font) =>
        font.familyName.startsWith("IBM Plex Sans") && font.isCustomFont,
    )
  )
    throw new Error("Interface is not rendering the bundled Plex font");
  const output = process.env.FORGECUT_APPEARANCE_SCREENSHOTS;
  const screenshot = async (name) => {
    if (!output) return;
    await mkdir(output, { recursive: true });
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(
      join(output, `${name}.png`),
      Buffer.from(shot.result.data, "base64"),
    );
  };
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
      await choose(mode, mode === "dark" ? "cobalt" : "sage");
      await settle();
      await evaluate(
        `document.querySelector('.clip-selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })`,
      );
      const issues = await evaluate(`(() => {
        const issues = [];
        if (!getComputedStyle(document.body).fontFamily.includes('IBM Plex Sans')) issues.push('Missing interface font');
        if (![...document.fonts].some(face => face.family.replaceAll('"', '') === 'IBM Plex Sans' && face.status === 'loaded')) issues.push('Offline interface font did not load');
        for (const button of document.querySelectorAll('.action-button')) {
          const box = button.getBoundingClientRect();
          if (!box.width || !box.height) continue;
          if (box.left < -1 || box.right > innerWidth + 1) issues.push('Button outside window: ' + button.textContent);
          if (box.height < 27) issues.push('Button too short: ' + button.textContent);
          if (button.scrollWidth > button.clientWidth + 1 && !button.classList.contains('layer-select')) issues.push('Clipped button text: ' + button.textContent);
          const icon = button.querySelector(':scope > svg');
          const text = [...button.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
          if (icon && text) {
            const range = document.createRange(); range.selectNodeContents(text);
            const textBox = range.getBoundingClientRect();
            if (textBox.width && textBox.left < icon.getBoundingClientRect().right - 1) issues.push('Overlapping icon: ' + button.textContent);
          }
        }
        const root = document.querySelector('.shell').getBoundingClientRect();
        if (root.width > innerWidth + 1) issues.push('Editor overflows window');
        if ('${state}' === 'code' && innerWidth === 1024) {
          const editor = document.querySelector('.code-editor-host').getBoundingClientRect();
          if (editor.width < 500 || editor.height < 200) issues.push('Code editor is cramped: ' + Math.round(editor.width) + 'x' + Math.round(editor.height));
        }
        const selected = document.querySelector('.clip-selected');
        const scroll = document.querySelector('.timeline-scroll');
        if (selected && scroll) {
          const clipBox = selected.getBoundingClientRect();
          const scrollBox = scroll.getBoundingClientRect();
          if (clipBox.bottom > scrollBox.bottom + 1) issues.push('Selected track is inaccessible');
        }
        if (document.documentElement.dataset.theme !== '${mode}') issues.push('Wrong mode');
        return issues;
      })()`);
      if (issues?.length)
        throw new Error(`${state} ${mode} ${width}px: ${issues.join("; ")}`);
      await screenshot(`${state}-${mode}-${width}`);
    }
  }
  await send("Emulation.clearDeviceMetricsOverride");
  await choose("dark", "cobalt");
  if (state === "empty") {
    await choose("light", "copper");
    await send("Page.reload", { ignoreCache: true });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const restored = await evaluate(
      `document.documentElement.dataset.theme === 'light' && document.documentElement.dataset.accent === 'copper'`,
    );
    if (!restored) throw new Error("Appearance did not survive native reload");
    await choose("dark", "cobalt");
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1024,
      height: 768,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(`(async () => {
      const invoke = async (command, args) => {
        const response = await window.forgecut.invoke(command, args);
        if (!response.ok) throw new Error(response.error.message);
        return response.value;
      };
      const before = await invoke('get_project_snapshot');
      window.__appearanceProjectBeforeNames = JSON.stringify(before.project);
      await invoke('update_project', { name: 'A longer project name with enough words to check the title bar layout and truncation'.repeat(2) });
      await invoke('rename_sequence', { sequenceId: before.project.default_sequence.id, name: 'A longer sequence name for checking the sequence selector without moving the editing controls'.repeat(2) });
      return true;
    })()`);
    await settle();
    const fits = await evaluate(`(() => {
      const name = document.querySelector('.project-name').getBoundingClientRect();
      const actions = document.querySelector('.project-actions').getBoundingClientRect();
      const sequence = document.querySelector('select[aria-label="Active sequence"]').getBoundingClientRect();
      const create = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'New sequence').getBoundingClientRect();
      return name.right <= actions.left && sequence.right < create.left;
    })()`);
    if (!fits) throw new Error("Long names overlap editor controls");
    await screenshot("long-labels-dark-1024");
    await evaluate(`(async () => {
      for (let index = 0; index < 2; index++) {
        const response = await window.forgecut.invoke('undo');
        if (!response.ok) throw new Error(response.error.message);
      }
      const restored = (await window.forgecut.invoke('get_project_snapshot')).value;
      if (JSON.stringify(restored.project) !== window.__appearanceProjectBeforeNames) throw new Error('Appearance checks changed project data');
      delete window.__appearanceProjectBeforeNames;
      return true;
    })()`);
    await send("Emulation.clearDeviceMetricsOverride");
  }
  console.log(
    `Aluminum ${state} appearance verified in both themes at 1280px and 1024px`,
  );
}
