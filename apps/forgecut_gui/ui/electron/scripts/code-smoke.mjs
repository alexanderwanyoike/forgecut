import { writeFile } from "node:fs/promises";
import { verifyCanvas } from "./canvas-smoke.mjs";

export async function verifyCode(send) {
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
  const wait = async (expression, label) => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Code editor timed out: ${label}`);
  };
  const click = async (label) => {
    await wait(
      `(()=>{const button=[...document.querySelectorAll('button')].find(value=>value.textContent.trim()===${JSON.stringify(label)});return button&&!button.disabled;})()`,
      `available ${label}`,
    );
    const found = await evaluate(
      `(()=>{const button=[...document.querySelectorAll('button')].find(value=>value.textContent.trim()===${JSON.stringify(label)});if(!button||button.disabled)return false;button.click();return true;})()`,
    );
    if (!found) throw new Error(`Code action unavailable: ${label}`);
  };
  const snapshot = await evaluate(
    `(async()=>{const result=await window.forgecut.invoke('get_project_snapshot');if(!result.ok)throw new Error(result.error.message);return result.value;})()`,
  );
  const item = snapshot.project.timeline.tracks
    .flatMap((track) => track.items)
    .find((value) => value.RemotionGraphic).RemotionGraphic;
  const component = snapshot.project.components.find(
    (value) =>
      value.id === item.component_id &&
      value.version === item.component_version,
  );
  const draft = () =>
    `(async()=>{const result=await window.forgecut.invoke('get_graphic_draft',{itemId:${JSON.stringify(item.id)}});if(!result.ok)throw new Error(result.error.message);return result.value;})()`;
  const replace = async (code) => {
    await send("Page.bringToFront");
    await evaluate(
      `document.querySelector('.monaco-source-editor textarea').focus()`,
    );
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      modifiers: 2,
      windowsVirtualKeyCode: 65,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      modifiers: 2,
      windowsVirtualKeyCode: 65,
    });
    await evaluate(
      `(()=>{const transfer=new DataTransfer();transfer.setData('text/plain',${JSON.stringify(code)});document.querySelector('.monaco-source-editor textarea').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));})()`,
    );
    await wait(
      `(async()=>{const value=await ${draft()};return value.component.source.files[${JSON.stringify(component.source.entry)}]===${JSON.stringify(code)};})()`,
      "source autosave",
    );
  };
  await click("Edit code");
  await wait(
    `!!document.querySelector('.monaco-source-editor[data-ready="true"]')`,
    "offline Monaco worker",
  );
  await evaluate(`document.querySelector('.theme-toggle').click()`);
  await wait(
    `!!document.querySelector('.monaco-source-editor[data-ready="true"]')`,
    "theme preserves editor",
  );
  await evaluate(`document.querySelector('.theme-toggle').click()`);
  const working = await evaluate(draft());
  working.component.source.files["helpers.ts"] =
    "export function word(value: string){return value}";
  await evaluate(
    `(async()=>{const result=await window.forgecut.invoke('save_graphic_draft',${JSON.stringify({ itemId: item.id, sessionId: snapshot.sessionId, expectedDraftRevision: working.revision, baseVersion: working.baseVersion, component: working.component })});if(!result.ok)throw new Error(result.error.message);})()`,
  );
  await wait(
    `!!document.querySelector('select[aria-label="Source file"] option[value="helpers.ts"]')`,
    "agent workspace file update",
  );
  await replace(
    "import { word } from './helpers';\nexport default function Card({values}:ForgeCut.Props){return <div>{word(values.title)}</div>}",
  );
  const key = async (name, code, virtual, modifiers = 0) => {
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: name,
      code,
      windowsVirtualKeyCode: virtual,
      modifiers,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: name,
      code,
      windowsVirtualKeyCode: virtual,
      modifiers,
    });
  };
  await key("Home", "Home", 36, 2);
  for (let index = 0; index < 10; index += 1)
    await key("ArrowRight", "ArrowRight", 39);
  await key("F12", "F12", 123);
  await wait(
    `document.querySelector('select[aria-label="Source file"]').value==='helpers.ts'`,
    "local source navigation",
  );
  await evaluate(
    `(()=>{const select=document.querySelector('select[aria-label="Source file"]');select.value=${JSON.stringify(component.source.entry)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await replace(
    "export default function Card({values}:ForgeCut.Props){return values.",
  );
  await key(" ", "Space", 32, 2);
  await wait(
    `document.querySelector('.suggest-widget.visible')?.textContent.includes('animation')`,
    "schema completion",
  );
  await key("Escape", "Escape", 27);
  await replace(
    "export default function Card({values}: ForgeCut.Props){const bad:number=values.title;return <div>{bad}</div>}",
  );
  await wait(
    `document.querySelector('.code-diagnostics')?.textContent.includes('not assignable to type')`,
    "live TypeScript diagnostics",
  );
  await wait(
    `!document.querySelector('.code-diagnostics')?.textContent.includes("Cannot find module")`,
    "approved package types",
  );
  const original = component.source.files[component.source.entry];
  const edited = original.replace("(1 - entrance) * 20", "(1 - entrance) * 32");
  if (edited === original)
    throw new Error("Native source fixture did not change");
  await replace(edited);
  await click("Preview draft");
  await wait(
    `(()=>{const image=document.querySelector('img[alt="Draft preview"]');return image?.complete&&image.naturalWidth>0;})()`,
    "isolated draft preview",
  );
  const goodImage = await evaluate(
    `document.querySelector('img[alt="Draft preview"]').src`,
  );
  await replace("export default function Broken( {");
  await click("Preview draft");
  await wait(
    `!!document.querySelector('.code-diagnostics')`,
    "syntax diagnostics",
  );
  await replace(
    'export default function Card(){throw new Error("Draft frame failure");return null;}',
  );
  await click("Preview draft");
  await wait(
    `document.querySelector('.code-workspace')?.textContent.includes('Draft frame failure')`,
    "runtime error",
  );
  await wait(
    `document.querySelector('.code-diagnostics button')?.textContent.includes('main.tsx:1:')`,
    "original runtime source location",
  );
  await evaluate(`document.querySelector('.code-diagnostics button').click()`);
  await wait(
    `document.activeElement?.getAttribute('aria-label')==='Graphic source editor'`,
    "runtime diagnostic navigation",
  );
  if (
    (await evaluate(
      `document.querySelector('img[alt="Draft preview"]').src`,
    )) !== goodImage
  )
    throw new Error("A failed draft discarded the last good preview");
  const beforeApply = await evaluate(
    `(async()=>{return (await window.forgecut.invoke('get_project_snapshot')).value;})()`,
  );
  if (JSON.stringify(beforeApply.project) !== JSON.stringify(snapshot.project))
    throw new Error("Draft edits changed the active project before Apply");
  await replace(edited);
  await click("Apply source");
  await wait(
    `document.querySelector('.code-footer')?.textContent.includes('Source applied')`,
    "source Apply",
  );
  const applied = await evaluate(
    `(async()=>{return (await window.forgecut.invoke('get_project_snapshot')).value;})()`,
  );
  const appliedItem = applied.project.timeline.tracks
    .flatMap((track) => track.items)
    .find((value) => value.RemotionGraphic?.id === item.id).RemotionGraphic;
  if (
    applied.revision !== snapshot.revision + 1 ||
    appliedItem.component_version === item.component_version ||
    JSON.stringify(appliedItem.props) !== JSON.stringify(item.props)
  )
    throw new Error(
      "Source Apply did not preserve properties in one project edit",
    );
  const saved = await evaluate(draft());
  if (saved.baseVersion !== appliedItem.component_version)
    throw new Error("Applied source draft base did not advance");
  await evaluate(
    `document.querySelector('.monaco-source-editor textarea').focus()`,
  );
  await key("z", "KeyZ", 90, 2);
  await wait(
    `(async()=>{const value=await ${draft()};return value.component.source.files[${JSON.stringify(component.source.entry)}]!==${JSON.stringify(edited)};})()`,
    "Monaco draft undo",
  );
  const afterDraftUndo = await evaluate(
    `(async()=>{return (await window.forgecut.invoke('get_project_snapshot')).value;})()`,
  );
  if (
    JSON.stringify(afterDraftUndo.project) !== JSON.stringify(applied.project)
  )
    throw new Error("Draft undo changed the active project");
  await key("y", "KeyY", 89, 2);
  await wait(
    `(async()=>{const value=await ${draft()};return value.component.source.files[${JSON.stringify(component.source.entry)}]===${JSON.stringify(edited)};})()`,
    "Monaco draft redo",
  );
  if (process.env.FORGECUT_CHECK_SCREENSHOT) {
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(
      process.env.FORGECUT_CHECK_SCREENSHOT,
      Buffer.from(screenshot.result.data, "base64"),
    );
  }
  await click("Canvas");
  await wait(`!document.querySelector('.code-workspace')`, "return to canvas");
  await verifyCanvas(send);
  const undone = await evaluate(
    `(async()=>{const result=await window.forgecut.invoke('undo');if(!result.ok)throw new Error(result.error.message);return (await window.forgecut.invoke('get_project_snapshot')).value;})()`,
  );
  if (JSON.stringify(undone.project) !== JSON.stringify(snapshot.project))
    throw new Error("Source Apply did not undo in one step");
  console.log(
    "Offline Monaco diagnostics, recoverable draft preview, Apply and project undo verified",
  );
}
