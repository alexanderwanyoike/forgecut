import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { graphicSourceSchema } from "../shared/graphic-source-schema.js";
import { graphicPropertiesSchema } from "../shared/graphic-property-schema.js";
import { compileGraphicSource } from "./compile.js";

async function main() {
  const directory = dirname(fileURLToPath(import.meta.url));
  const source = graphicSourceSchema
    .extend({ properties: graphicPropertiesSchema.optional() })
    .parse(JSON.parse(await readFile(process.argv[2], "utf8")));
  const libraries = z
    .record(z.string(), z.string())
    .parse(JSON.parse(await readFile(join(directory, "types.json"), "utf8")));
  process.stdout.write(
    JSON.stringify(
      await compileGraphicSource(source, libraries, source.properties),
    ),
  );
}
void main().catch((failure: unknown) => {
  console.error(failure instanceof Error ? failure.message : String(failure));
  process.exitCode = 1;
});
