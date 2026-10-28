import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

export async function verifyPreviewReadiness(directory, send) {
  const source = join(directory, "preview-readiness.mkv");
  const project = join(directory, "preview-readiness.forgecut");
  const generated = spawnSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-threads",
    "1",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=320x180:r=30:d=1",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x180:r=30:d=2",
    "-filter_complex_threads",
    "1",
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1:a=0",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    source,
  ]);
  if (generated.status !== 0) throw new Error(generated.stderr.toString());
  const result = await send("Runtime.evaluate", {
    expression: `(async () => {
      const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const invoke = async (command, args) => { const r = await window.forgecut.invoke(command, args); if (!r.ok) throw new Error(r.error.message); await settle(); return r.value; };
      await invoke('create_project');
      await invoke('init_default_tracks');
      await invoke('update_project', { name: 'Preview frame readiness', settings: { width: 320, height: 180, fps: 30 } });
      const assets = await invoke('import_assets', { paths: [${JSON.stringify(source)}] });
      const snapshot = await invoke('get_project_snapshot');
      const track = snapshot.project.timeline.tracks.find(track => track.kind === 'Video');
      await invoke('add_clip_to_timeline', { assetId: assets[0].id, trackId: track.id, timelineStartUs: 0, sourceInUs: 1000000, sourceOutUs: 2500000 });
      await invoke('save_project', { path: ${JSON.stringify(project)} });
      await invoke('create_project');
      const seen = new WeakSet();
      const presented = new WeakMap();
      let stopped = false;
      let badFrames = 0;
      let decodedFrames = 0;
      let exposedBeforeReady = 0;
      const watch = () => {
        if (stopped) return;
        const video = document.querySelector('.preview-composition video');
        if (video && !seen.has(video)) {
          seen.add(video);
          const style = getComputedStyle(video);
          if (!video.hidden && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && (video.readyState < 2 || video.seeking || video.currentTime < 0.95)) exposedBeforeReady += 1;
          const frame = (_, metadata) => {
            if (stopped) return;
            presented.set(video, metadata.mediaTime);
            decodedFrames += 1;
            if (video.isConnected && getComputedStyle(video).visibility !== 'hidden' && metadata.mediaTime < 0.95) badFrames += 1;
            video.requestVideoFrameCallback(frame);
          };
          video.requestVideoFrameCallback(frame);
        }
      };
      const observer = new MutationObserver(watch);
      observer.observe(document.body, { childList: true, subtree: true });
      watch();
      const wait = async predicate => {
        for (let n = 0; n < 400; n++) {
          if (predicate()) return;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error('Selected preview frame did not become visible');
      };
      try {
        for (let cycle = 0; cycle < 3; cycle++) {
          await invoke('load_project', { path: ${JSON.stringify(project)} });
          await wait(() => {
            const v = document.querySelector('.preview-composition video');
            return v && !v.seeking && getComputedStyle(v).visibility === 'visible' && Math.abs((presented.get(v) ?? -1) - 1) < 0.06;
          });
          if (badFrames || exposedBeforeReady) throw new Error('Preview exposed unready/source-start frames before the selected cut: ' + JSON.stringify({ badFrames, exposedBeforeReady }));
          if (cycle < 2) await invoke('create_project');
        }
        const play = document.querySelector('.preview-controls button[aria-label="Play sequence"]');
        play.click();
        await wait(() => document.querySelector('.preview-controls button[aria-label="Play sequence"]') && decodedFrames > 8);
        if (badFrames) throw new Error('Playback exposed source-start frames: ' + badFrames);
        const ruler = document.querySelector('.time-ruler');
        const bounds = ruler.getBoundingClientRect();
        const start = Number.parseFloat(ruler.querySelector('.ruler-tick').style.left);
        ruler.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: bounds.left + start, clientY: bounds.top + 5 }));
        window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        await wait(() => {
          const v = document.querySelector('.preview-composition video');
          return v && !v.seeking && getComputedStyle(v).visibility === 'visible' && Math.abs((presented.get(v) ?? -1) - 1) < 0.06;
        });
        if (badFrames) throw new Error('Scrubbing exposed source-start frames: ' + badFrames);
        return { correct: true, badFrames, exposedBeforeReady, decodedFrames };
      } finally { stopped = true; observer.disconnect(); }
    })()`,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (result.result?.exceptionDetails || !result.result?.result?.value?.correct)
    throw new Error(
      `Preview readiness failed: ${JSON.stringify(result.result)}`,
    );
  const screenshot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    join(directory, "preview-readiness.png"),
    Buffer.from(screenshot.result.data, "base64"),
  );
  console.log(
    "Native preview exposed no source-start frames across three loads and playback",
  );
}
