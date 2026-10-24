import * as monaco from "monaco-editor/editor/editor.api";
import * as typescript from "monaco-editor/languages/features/typescript/register";
import "monaco-editor/languages/definitions/typescript/register";
import "monaco-editor/languages/definitions/javascript/register";
import "monaco-editor/languages/features/json/register";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import TypeScriptWorker from "monaco-editor/languages/features/typescript/ts.worker?worker";
import JsonWorker from "monaco-editor/languages/features/json/json.worker?worker";
import { invoke } from "./bridge";

globalThis.MonacoEnvironment = {
  getWorker: (_module, label) => {
    if (label === "typescript" || label === "javascript")
      return new TypeScriptWorker();
    if (label === "json") return new JsonWorker();
    return new EditorWorker();
  },
};
const options: typescript.CompilerOptions = {
  target: typescript.ScriptTarget.ESNext,
  module: typescript.ModuleKind.ESNext,
  moduleResolution: typescript.ModuleResolutionKind.NodeJs,
  jsx: typescript.JsxEmit.ReactJSX,
  strict: true,
  allowJs: true,
  checkJs: true,
  skipLibCheck: true,
  allowSyntheticDefaultImports: true,
  resolveJsonModule: true,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  types: [],
};
typescript.typescriptDefaults.setCompilerOptions(options);
typescript.javascriptDefaults.setCompilerOptions(options);
typescript.typescriptDefaults.setEagerModelSync(true);
typescript.javascriptDefaults.setEagerModelSync(true);
let libraries: Promise<Record<string, string>> | undefined;
export function loadMonacoLibraries(): Promise<Record<string, string>> {
  libraries ??= invoke("get_graphic_type_libraries").catch(
    (failure: unknown) => {
      libraries = undefined;
      throw failure;
    },
  );
  return libraries;
}
export { monaco, typescript };

export async function readyTypeScriptWorker() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await typescript.getTypeScriptWorker();
    } catch (failure) {
      // Monaco activates language services asynchronously after model creation.
      if (failure !== "TypeScript not registered!") throw failure;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50);
      });
    }
  }
  throw new Error("The TypeScript language service did not start");
}
