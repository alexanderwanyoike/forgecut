import ts from "typescript";
import type { GraphicComponent } from "../shared/graphics.js";
import type { GraphicDiagnostic } from "../shared/graphic-source.js";

export const executableSource = /\.(?:[cm]?[jt]s|[jt]sx)$/;
export function importDiagnostics(
  source: GraphicComponent["source"],
): GraphicDiagnostic[] {
  const diagnostics: GraphicDiagnostic[] = [];
  if (!executableSource.test(source.entry))
    return [
      {
        file: source.entry,
        line: 1,
        column: 1,
        message:
          "The component entry must be a JavaScript or TypeScript source file",
      },
    ];
  for (const [name, content] of Object.entries(source.files)) {
    if (!executableSource.test(name)) continue;
    const file = ts.createSourceFile(
      name,
      content,
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))
      ) {
        const argument = node.arguments[0];
        if (!argument || !ts.isStringLiteralLike(argument)) {
          const point = file.getLineAndCharacterOfPosition(node.getStart(file));
          if (diagnostics.length < 100)
            diagnostics.push({
              file: name,
              line: point.line + 1,
              column: point.character + 1,
              message:
                "Module imports require a literal workspace or approved package path",
            });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return diagnostics;
}
