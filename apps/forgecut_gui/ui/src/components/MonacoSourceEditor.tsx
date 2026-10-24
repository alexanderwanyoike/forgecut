import { useEffect, useRef } from "react";
import {
  monaco,
  typescript,
  loadMonacoLibraries,
  readyTypeScriptWorker,
} from "../lib/monaco-runtime";
import { graphicTypeDeclarations } from "../../electron/shared/graphic-type-declarations";
import type { GraphicComponent } from "../../electron/shared/graphics";
import type { GraphicDiagnostic } from "../../electron/shared/graphic-source";

type Props = {
  files: Record<string, string>;
  properties: GraphicComponent["properties"];
  path: string;
  onChange: (path: string, value: string) => void;
  onPathChange: (path: string) => void;
  diagnostics: GraphicDiagnostic[];
  location?: GraphicDiagnostic;
  onDiagnostics: (items: GraphicDiagnostic[]) => void;
  onError: (failure: unknown) => void;
};
const root = "/forgecut/component/";
const uri = (path: string) =>
  monaco.Uri.file(
    path === "@contract" ? "/forgecut/component-schema.d.ts" : root + path,
  );
function language(path: string): string {
  if (path.endsWith(".json")) return "json";
  if (/\.(?:[cm]?js|jsx)$/.test(path)) return "javascript";
  return "typescript";
}
export default function MonacoSourceEditor(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const models = useRef(new Map<string, monaco.editor.ITextModel>());
  const current = useRef(props);
  current.current = props;
  const updating = useRef(false);
  const packageTypes = useRef<Record<string, string> | null>(null);
  const markerSignature = useRef("");
  const sync = () => {
    const input = current.current;
    updating.current = true;
    const files = {
      ...input.files,
      "@contract": graphicTypeDeclarations(input.properties),
    };
    for (const [path, value] of Object.entries(files)) {
      let model = models.current.get(path);
      if (!model) {
        model = monaco.editor.createModel(value, language(path), uri(path));
        models.current.set(path, model);
      } else if (model.getValue() !== value) model.setValue(value);
    }
    for (const [path, model] of models.current)
      if (!Object.prototype.hasOwnProperty.call(files, path)) {
        model.dispose();
        models.current.delete(path);
      }
    const selected = models.current.get(input.path);
    if (selected && editor.current?.getModel() !== selected)
      editor.current?.setModel(selected);
    editor.current?.updateOptions({ readOnly: input.path === "@contract" });
    if (packageTypes.current) {
      const extra = [
        ...Object.entries(packageTypes.current).map(([path, content]) => ({
          filePath: monaco.Uri.file(path).toString(true),
          content,
        })),
        { filePath: uri("@contract").toString(), content: files["@contract"] },
      ];
      typescript.typescriptDefaults.setExtraLibs(extra);
      typescript.javascriptDefaults.setExtraLibs(extra);
    }
    updating.current = false;
  };
  useEffect(() => {
    if (!host.current) return undefined;
    let disposed = false;
    editor.current = monaco.editor.create(host.current, {
      model: null,
      theme:
        document.documentElement.getAttribute("data-theme") === "light"
          ? "vs"
          : "vs-dark",
      automaticLayout: true,
      editContext: false,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      tabSize: 2,
      ariaLabel: "Graphic source editor",
      padding: { top: 10, bottom: 10 },
    });
    sync();
    const theme = new MutationObserver(() =>
      monaco.editor.setTheme(
        document.documentElement.getAttribute("data-theme") === "light"
          ? "vs"
          : "vs-dark",
      ),
    );
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const changes = editor.current.onDidChangeModelContent(() => {
      const model = editor.current?.getModel();
      if (updating.current || !model) return;
      const path = model.uri.path.startsWith(root)
        ? model.uri.path.slice(root.length)
        : "@contract";
      if (path !== "@contract")
        current.current.onChange(path, model.getValue());
    });
    const opener = monaco.editor.registerEditorOpener({
      openCodeEditor: (_source, resource, selection) => {
        let path = "";
        if (resource.path === "/forgecut/component-schema.d.ts")
          path = "@contract";
        else if (resource.path.startsWith(root))
          path = resource.path.slice(root.length);
        const model = models.current.get(path);
        if (!model || !editor.current) return false;
        current.current.onPathChange(path);
        editor.current.setModel(model);
        if (selection) {
          if ("startLineNumber" in selection) {
            editor.current.setSelection(selection);
            editor.current.revealRangeInCenter(selection);
          } else editor.current.setPosition(selection);
        }
        editor.current.focus();
        return true;
      },
    });
    const markers = monaco.editor.onDidChangeMarkers(() => {
      const items: GraphicDiagnostic[] = [];
      for (const [path, model] of models.current) {
        if (path === "@contract") continue;
        for (const marker of monaco.editor.getModelMarkers({
          resource: model.uri,
        }))
          if (
            marker.owner !== "forgecut" &&
            marker.severity >= monaco.MarkerSeverity.Warning
          )
            items.push({
              file: path,
              line: marker.startLineNumber,
              column: marker.startColumn,
              message: marker.message,
            });
      }
      const signature = JSON.stringify(items);
      if (signature !== markerSignature.current) {
        markerSignature.current = signature;
        current.current.onDiagnostics(items);
      }
    });
    void loadMonacoLibraries()
      .then(async (libraries) => {
        if (disposed) return;
        packageTypes.current = libraries;
        sync();
        const factory = await readyTypeScriptWorker();
        await factory(
          ...[...models.current.values()].map((model) => model.uri),
        );
        if (!disposed && host.current) host.current.dataset.ready = "true";
      })
      .catch((failure: unknown) => {
        if (!disposed) current.current.onError(failure);
      });
    return () => {
      disposed = true;
      theme.disconnect();
      changes.dispose();
      opener.dispose();
      markers.dispose();
      editor.current?.dispose();
      editor.current = null;
      for (const model of models.current.values()) model.dispose();
      models.current.clear();
      typescript.typescriptDefaults.setExtraLibs([]);
      typescript.javascriptDefaults.setExtraLibs([]);
    };
  }, []);
  useEffect(() => {
    sync();
  }, [props.files, props.properties, props.path]);
  useEffect(() => {
    for (const [path, model] of models.current)
      monaco.editor.setModelMarkers(
        model,
        "forgecut",
        props.diagnostics
          .filter((value) => value.file === path)
          .map((value) => ({
            severity: monaco.MarkerSeverity.Error,
            message: value.message,
            startLineNumber: value.line,
            startColumn: value.column,
            endLineNumber: value.line,
            endColumn: value.column + 1,
          })),
      );
  }, [props.diagnostics]);
  useEffect(() => {
    if (!props.location) return;
    editor.current?.setPosition({
      lineNumber: props.location.line,
      column: props.location.column,
    });
    editor.current?.revealLineInCenter(props.location.line);
    editor.current?.focus();
  }, [props.location]);
  return <div className="monaco-source-editor" ref={host} data-ready="false" />;
}
