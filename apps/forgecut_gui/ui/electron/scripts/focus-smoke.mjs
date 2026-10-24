export async function verifyFocus(send, state) {
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.result?.exceptionDetails)
      throw new Error(JSON.stringify(response.result.exceptionDetails));
    return response.result?.result?.value;
  };
  const before = await evaluate(
    `({ theme: document.documentElement.dataset.theme, accent: document.documentElement.dataset.accent })`,
  );
  const pointerClick = async (label) => {
    const bounds = await evaluate(`(() => {
      const button = document.querySelector('button[aria-label="${label}"]');
      const rect = button.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...bounds });
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      ...bounds,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      ...bounds,
    });
    await evaluate(
      `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
    );
  };
  try {
    for (const theme of ["dark", "light"]) {
      for (const accent of ["cobalt", "sage", "copper", "plum", "amber"]) {
        await evaluate(`(() => {
          document.documentElement.dataset.theme = '${theme}';
          document.documentElement.dataset.accent = '${accent}';
          const target = '${state}' === 'code' ? document.querySelector('.code-workspace button:not(:disabled)') : document.querySelector('button[aria-label="Appearance"]');
          target.focus();
        })()`);
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
        const focus = await evaluate(`(() => {
          const element = document.activeElement;
          const style = getComputedStyle(element);
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d');
          context.fillStyle = style.outlineColor;
          context.fillRect(0, 0, 1, 1);
          const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
          return { visible: element.matches(':focus-visible'), width: parseFloat(style.outlineWidth), style: style.outlineStyle, rgb };
        })()`);
        if (!focus.visible || focus.width < 1 || focus.style === "none")
          throw new Error(
            `${state} ${theme} ${accent}: keyboard focus is not visible`,
          );
        if (Math.max(...focus.rgb) - Math.min(...focus.rgb) > 24)
          throw new Error(
            `${state} ${theme} ${accent}: focus outline is colored rather than neutral: ${focus.rgb}`,
          );
        await pointerClick("Appearance");
        await pointerClick("Close appearance");
        const pointerFocus = await evaluate(`(() => {
          const element = document.querySelector('button[aria-label="Appearance"]');
          const style = getComputedStyle(element);
          return element.matches(':focus-visible') || (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0);
        })()`);
        if (pointerFocus)
          throw new Error(
            `${state} ${theme} ${accent}: mouse click leaves a focus ring`,
          );
      }
    }
  } finally {
    await evaluate(`(() => {
      document.documentElement.dataset.theme = ${JSON.stringify(before.theme)};
      document.documentElement.dataset.accent = ${JSON.stringify(before.accent)};
      document.activeElement?.blur();
    })()`);
  }
  console.log(
    `Neutral keyboard focus and ring-free mouse interactions verified in ${state}`,
  );
}
