import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  makeCancelSignal,
  openBrowser,
  renderMedia,
  selectComposition,
} from "@remotion/renderer";
import {
  graphicRenderJobSchema,
  renderEncoding,
} from "./graphic-render-job.js";

async function main() {
  const runtime = dirname(fileURLToPath(import.meta.url));
  const metadata = z
    .object({ browserExecutable: z.string(), titleSourceHash: z.string() })
    .parse(
      JSON.parse(await readFile(resolve(runtime, "runtime.json"), "utf8")),
    );
  const job = graphicRenderJobSchema.parse(
    JSON.parse(await readFile(process.argv[2], "utf8")),
  );
  if (!job.code && job.sourceHash !== metadata.titleSourceHash)
    throw new Error(
      "The graphics runtime source does not match this component version. Rebuild the runtime.",
    );
  const { cancel, cancelSignal } = makeCancelSignal();
  process.once("SIGTERM", cancel);
  const browser = await openBrowser("chrome", {
    browserExecutable: resolve(runtime, metadata.browserExecutable),
    logLevel: "error",
    chromiumOptions: { gl: "swangle" },
  });
  try {
    const common = {
      serveUrl: resolve(runtime, "composition"),
      puppeteerInstance: browser,
      binariesDirectory: resolve(runtime, "compositor"),
      inputProps: {
        values: job.values,
        code: job.code,
        layerStates: job.layerStates,
        resources: job.resources,
        width: job.width,
        height: job.height,
        fps: job.fps,
        duration: job.duration,
      },
      logLevel: "error" as const,
      timeoutInMilliseconds: job.code ? 7000 : 10000,
      cancelSignal,
      onBrowserDownload: () => {
        throw new Error(
          "The packaged browser is required; runtime downloads are disabled.",
        );
      },
    };
    const composition = await selectComposition({ ...common, id: "Graphic" });
    await renderMedia({
      ...common,
      composition,
      ...renderEncoding(job),
      imageFormat: "png",
      muted: true,
      frameRange: [0, Math.min(job.duration, job.renderFrames) - 1],
      outputLocation: job.output,
    });
  } finally {
    await browser.close({ silent: true });
  }
}
void main().catch((failure: unknown) => {
  console.error(failure);
  process.exitCode = 1;
});
