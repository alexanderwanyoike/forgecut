import { posix } from "node:path";
import { build, type Message, type BuildFailure } from "esbuild";
import { executableSource, importDiagnostics } from "./import-policy.js";
import type { GraphicComponent } from "../shared/graphics.js";
import {
  graphicPackages,
  type GraphicCompilation,
  type GraphicDiagnostic,
} from "../shared/graphic-source.js";
import { checkTypes } from "./type-check.js";
import { graphicTypeDeclarations } from "../shared/graphic-type-declarations.js";

export async function compileGraphicSource(
  source: GraphicComponent["source"],
  libraries: Record<string, string>,
  properties?: GraphicComponent["properties"],
): Promise<GraphicCompilation> {
  const invalid = (diagnostics: GraphicDiagnostic[]): GraphicCompilation => ({
    ok: false,
    error: {
      code: "INVALID_SOURCE",
      message: "Graphic source has diagnostics",
      diagnostics,
    },
  });
  const policy = importDiagnostics(source);
  if (policy.length) return invalid(policy);
  try {
    const result = await build({
      entryPoints: [source.entry],
      bundle: true,
      write: false,
      sourcemap: "inline",
      sourcesContent: false,
      format: "cjs",
      platform: "browser",
      target: "es2022",
      supported: { "dynamic-import": false },
      jsx: "automatic",
      logLevel: "silent",
      plugins: [
        {
          name: "forgecut-workspace",
          setup(plugin) {
            plugin.onResolve({ filter: /.*/ }, (args) => {
              if (graphicPackages.some((name) => name === args.path))
                return { path: args.path, external: true };
              if (args.kind !== "entry-point" && !args.path.startsWith("."))
                return {
                  errors: [{ text: `Package is not approved: ${args.path}` }],
                };
              const base = posix.normalize(
                posix.join(
                  args.importer ? posix.dirname(args.importer) : "",
                  args.path,
                ),
              );
              const path = [
                base,
                `${base}.tsx`,
                `${base}.ts`,
                `${base}.jsx`,
                `${base}.js`,
                `${base}.json`,
                `${base}/index.tsx`,
                `${base}/index.ts`,
              ].find((candidate) => Object.hasOwn(source.files, candidate));
              if (
                path &&
                !executableSource.test(path) &&
                !path.endsWith(".json")
              )
                return {
                  errors: [
                    { text: `Unsupported workspace source extension: ${path}` },
                  ],
                };
              return path
                ? { path, namespace: "workspace" }
                : {
                    errors: [{ text: `Missing workspace file: ${args.path}` }],
                  };
            });
            plugin.onLoad({ filter: /.*/, namespace: "workspace" }, (args) => ({
              contents: source.files[args.path],
              loader: args.path.endsWith(".json") ? "json" : "tsx",
            }));
          },
        },
      ],
    });
    const schemaPath = "/forgecut/component-schema.d.ts";
    const types = properties
      ? { ...libraries, [schemaPath]: graphicTypeDeclarations(properties) }
      : libraries;
    const diagnostics = checkTypes(
      source,
      types,
      properties ? [schemaPath] : [],
    );
    if (diagnostics.length) return invalid(diagnostics);
    const code = result.outputFiles[0]?.text;
    if (!code || Buffer.byteLength(code) > 2097152)
      return invalid([
        {
          file: source.entry,
          line: 1,
          column: 1,
          message: "Compiled graphic exceeds 2 MiB",
        },
      ]);
    return { ok: true, value: { code } };
  } catch (failure) {
    const messages = (failure as Partial<BuildFailure>).errors;
    const diagnostics = (Array.isArray(messages) ? messages : [])
      .slice(0, 100)
      .map((message: Message) => ({
        file: message.location?.file.replace(/^workspace:/, "") ?? source.entry,
        line: message.location?.line ?? 1,
        column: (message.location?.column ?? 0) + 1,
        message: message.text.slice(0, 8192),
      }));
    if (diagnostics.length) return invalid(diagnostics);
    throw failure;
  }
}
