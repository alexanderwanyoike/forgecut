import { join } from "node:path";
import { spawnSync } from "node:child_process";
export async function verifyGraphicsPreview(directory, send) {
  const output = join(directory, "native-graphic.mp4");
  const result = await send("Runtime.evaluate", {
    expression: `(async () => {
      const invoke = async (command, args) => {
        const response = await window.forgecut.invoke(command, args);
        if (!response.ok) throw new Error(response.error.message);
        return response.value;
      };
      await invoke('create_project');
      await invoke('update_project', { settings: { width: 640, height: 360, fps: 10 } });
      await invoke('add_graphic_item', { templateId: 'title-card', trackId: crypto.randomUUID(), timelineStartUs: 0, durationUs: 1000000, props: { title: 'Graphics runtime check', entrance_frames: 0 } });
      let visible = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const layer = document.querySelector('[data-graphic-layer]');
        if (layer?.textContent === 'Graphics runtime check' && layer.getBoundingClientRect().width > 0) { visible = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      if (!visible) throw new Error('The real Remotion Player did not display the stored title.');
      const job = await invoke('export_project', { outputPath: ${JSON.stringify(output)} });
      for (let attempt = 0; attempt < 1500; attempt++) {
        const current = await invoke('get_media_job', { sessionId: job.sessionId, jobId: job.id });
        if (current.status === 'completed') return true;
        if (['failed', 'cancelled'].includes(current.status)) throw new Error(JSON.stringify(current));
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('Native graphics export timed out.');
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.result?.result?.value !== true)
    throw new Error(`Graphics preview failed: ${JSON.stringify(result)}`);
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-count_frames", "-show_streams", "-of", "json", output],
    { encoding: "utf8" },
  );
  if (probe.status !== 0) throw new Error(probe.stderr);
  const video = JSON.parse(probe.stdout).streams.find(
    (stream) => stream.codec_type === "video",
  );
  if (
    video?.width !== 640 ||
    video?.height !== 360 ||
    Number(video?.nb_read_frames) !== 10
  )
    throw new Error(
      "Native graphic export has unexpected dimensions or frame count.",
    );
}
