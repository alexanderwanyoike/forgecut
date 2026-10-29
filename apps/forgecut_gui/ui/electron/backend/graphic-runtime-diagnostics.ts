import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import type { GraphicDiagnostic } from "../shared/graphic-source.js";

export function graphicRuntimeDiagnostics(
  code: string,
  stack: string,
): GraphicDiagnostic[] {
  const encoded = code.match(
    /\/\/# sourceMappingURL=data:application\/json;base64,([a-z\d+/=]+)\s*$/i,
  )?.[1];
  const location = stack.match(/forgecut-component\.js:(\d+):(\d+)/);
  if (!encoded || !location) return [];
  try {
    const map = new TraceMap(Buffer.from(encoded, "base64").toString("utf8"));
    // The Function constructor adds two wrapper lines before the compiled body.
    const position = originalPositionFor(map, {
      line: Number(location[1]) - 2,
      column: Number(location[2]) - 1,
    });
    const file = position.source?.replace(/^workspace:/, "");
    if (
      !file ||
      !position.line ||
      position.column === null ||
      !/^[a-z\d_.-]+(?:\/[a-z\d_.-]+)*$/i.test(file) ||
      file.split("/").some((part) => part === "." || part === "..")
    )
      return [];
    return [
      {
        file,
        line: position.line,
        column: position.column + 1,
        message: stack.split("\n")[0].slice(0, 8192),
      },
    ];
  } catch {
    return [];
  }
}
