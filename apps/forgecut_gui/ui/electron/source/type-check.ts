import ts from "typescript";
import type { GraphicComponent } from "../shared/graphics.js";
import type { GraphicDiagnostic } from "../shared/graphic-source.js";

export function checkTypes(
  source: GraphicComponent["source"],
  libraries: Record<string, string>,
): GraphicDiagnostic[] {
  const root = "/forgecut/component/";
  const files = {
    ...libraries,
    ...Object.fromEntries(
      Object.entries(source.files).map(([name, content]) => [
        root + name,
        content,
      ]),
    ),
  };
  const directories = new Set<string>();
  for (const name of Object.keys(files)) {
    let parent = name.slice(0, name.lastIndexOf("/"));
    while (parent) {
      directories.add(parent);
      parent = parent.slice(0, parent.lastIndexOf("/"));
    }
  }
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    allowSyntheticDefaultImports: true,
    resolveJsonModule: true,
    types: [],
  };
  const host: ts.CompilerHost = {
    getSourceFile: (name, version) =>
      Object.hasOwn(files, name)
        ? ts.createSourceFile(name, files[name], version, true)
        : undefined,
    getDefaultLibFileName: () =>
      "/forgecut/typescript/lib/lib.es2022.full.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => root,
    getDirectories: (directory) =>
      [...directories].filter(
        (name) =>
          name.startsWith(`${directory}/`) &&
          !name.slice(directory.length + 1).includes("/"),
      ),
    fileExists: (name) => Object.hasOwn(files, name),
    readFile: (name) => files[name],
    directoryExists: (name) => directories.has(name.replace(/\/$/, "")),
    useCaseSensitiveFileNames: () => true,
    getCanonicalFileName: (name) => name,
    getNewLine: () => "\n",
  };
  const program = ts.createProgram(
    Object.keys(source.files)
      .filter((name) => /\.tsx?$/.test(name))
      .map((name) => root + name),
    options,
    host,
  );
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .slice(0, 100)
    .map((diagnostic) => {
      const location = diagnostic.file?.getLineAndCharacterOfPosition(
        diagnostic.start ?? 0,
      );
      return {
        file: diagnostic.file?.fileName.replace(root, "") ?? source.entry,
        line: (location?.line ?? 0) + 1,
        column: (location?.character ?? 0) + 1,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      };
    });
}
