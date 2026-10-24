import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { openBrowser } from "@remotion/renderer";
import { z } from "zod";
import { previewCommandSchema } from "./graphic-preview-protocol.js";
import type { GraphicPreviewInput } from "../shared/graphic-preview.js";

async function main() {
  const runtime = dirname(fileURLToPath(import.meta.url));
  const metadata = z
    .object({ browserExecutable: z.string() })
    .parse(JSON.parse(await readFile(join(runtime, "runtime.json"), "utf8")));
  const script = await readFile(join(runtime, "preview.js"));
  const html = Buffer.from(
    '<!doctype html><html><head><style>html,body{margin:0;background:transparent}#root{position:relative}</style></head><body><div id="root"></div><script src="/preview.js"></script></body></html>',
  );
  const server = createServer((request, response) => {
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'",
    );
    if (request.url === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(html);
    } else if (request.url === "/preview.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(script);
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Preview server did not open");
  const browser = await openBrowser("chrome", {
    browserExecutable: resolve(runtime, metadata.browserExecutable),
    logLevel: "error",
    chromiumOptions: { gl: "swangle" },
  });
  const page = await browser.newPage({
    context: () => null,
    logLevel: "error",
    indent: false,
    pageIndex: 0,
    onBrowserLog: null,
    onLog: () => {},
  });
  const session = await page.target().createCDPSession();
  await session.send("Emulation.setDefaultBackgroundColorOverride", {
    color: { r: 0, g: 0, b: 0, a: 0 },
  });
  await page.goto({ url: `http://127.0.0.1:${address.port}/`, timeout: 10000 });
  const inputs = new Map<string, GraphicPreviewInput>();
  process.stdout.write(
    `${JSON.stringify({ ok: true, id: 0, value: "ready" })}\n`,
  );
  try {
    for await (const line of createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    })) {
      let id = -1;
      try {
        if (Buffer.byteLength(line) > 33554432)
          throw new Error("Preview input exceeds 32 MiB");
        const request = previewCommandSchema.parse(JSON.parse(line));
        id = request.id;
        if (request.kind === "load") {
          inputs.set(request.input.key, request.input);
          while (inputs.size > 4)
            inputs.delete(inputs.keys().next().value ?? "");
          process.stdout.write(
            `${JSON.stringify({ ok: true, id, value: "loaded" })}\n`,
          );
          continue;
        }
        const input = inputs.get(request.key);
        if (!input) throw new Error("Preview context expired");
        if (request.frame >= input.duration)
          throw new Error("Preview frame is outside the component duration");
        const scale = Math.min(
          1,
          960 / input.width,
          960 / input.height,
          Math.sqrt(518400 / (input.width * input.height)),
        );
        const width = Math.max(1, Math.round(input.width * scale));
        const height = Math.max(1, Math.round(input.height * scale));
        await page.setViewport({ width, height, deviceScaleFactor: 1 });
        const response: unknown = await session.send("Runtime.evaluate", {
          expression: `window.graphicPreview(${JSON.stringify({ ...input, frame: request.frame, values: request.values, layerStates: request.layerStates })})`,
          awaitPromise: true,
          returnByValue: true,
        });
        const evaluated = z
          .object({
            value: z.object({
              exceptionDetails: z
                .object({
                  text: z.string(),
                  exception: z
                    .object({ description: z.string().optional() })
                    .optional(),
                })
                .optional(),
            }),
          })
          .parse(response);
        if (evaluated.value.exceptionDetails)
          throw new Error(
            evaluated.value.exceptionDetails.exception?.description ??
              evaluated.value.exceptionDetails.text,
          );
        const capture: unknown = await session.send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: false,
        });
        const screenshot = z
          .object({ value: z.object({ data: z.string() }) })
          .parse(capture);
        process.stdout.write(
          `${JSON.stringify({ ok: true, id, value: { mimeType: "image/png", data: screenshot.value.data, width, height } })}\n`,
        );
      } catch (failure) {
        process.stdout.write(
          `${JSON.stringify({ ok: false, id, error: { code: "RENDER_FAILED", message: (failure instanceof Error ? failure.message : String(failure)).slice(0, 8192) } })}\n`,
        );
      }
    }
  } finally {
    await browser.close({ silent: true });
    await new Promise<void>((done) => {
      server.close(() => done());
    });
  }
}
void main().catch((failure: unknown) => {
  console.error(failure);
  process.exitCode = 1;
});
