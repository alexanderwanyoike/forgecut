import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "../..");
const output = resolve(projectRoot, "electron/dist/graphics");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(projectRoot, "electron/graphics"), output, {
  recursive: true,
});
