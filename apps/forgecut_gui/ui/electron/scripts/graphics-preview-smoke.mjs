export async function verifyGraphicsPreview(send) {
  const result = await send("Runtime.evaluate", {
    expression: `(async () => {
      const invoke = async (command, args) => {
        const response = await window.forgecut.invoke(command, args);
        if (!response.ok) throw new Error(response.error.message);
        return response.value;
      };
      await invoke('create_project');
      await invoke('add_graphic_item', { templateId: 'title-card', trackId: crypto.randomUUID(), timelineStartUs: 0, durationUs: 3000000, props: { title: 'Graphics runtime check', entrance_frames: 0 } });
      for (let attempt = 0; attempt < 200; attempt++) {
        const layer = document.querySelector('[data-graphic-layer]');
        if (layer?.textContent === 'Graphics runtime check' && layer.getBoundingClientRect().width > 0) return true;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('The real Remotion Player did not display the stored title.');
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.result?.result?.value !== true)
    throw new Error(
      `Graphics preview failed: ${JSON.stringify(result)}`,
    );
}
