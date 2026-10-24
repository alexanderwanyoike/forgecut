import { spawnSync } from "node:child_process";
import { join } from "node:path";

export async function verifyAudio(directory, send) {
  const path = join(directory, "audio-smoke.wav");
  const generated = spawnSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=3",
    path,
  ]);
  if (generated.status !== 0) throw new Error(generated.stderr.toString());
  const result = await send("Runtime.evaluate", {
    expression: `(async () => {
      const invoke = async (command, args) => {
        const response = await window.forgecut.invoke(command, args);
        if (!response.ok) throw new Error(response.error.message);
        return response.value;
      };
      const waitFor = async (predicate) => {
        for (let attempt = 0; attempt < 150; attempt++) {
          if (predicate()) return;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw new Error('Preview audio did not reach the expected state: ' + JSON.stringify({ output: !!output, gain: output?.gain.value, context: output?.context.state, button: document.querySelector('.preview .preview-btn')?.getAttribute('aria-label'), audio: [...document.querySelectorAll('audio')].map(media => ({ src: media.currentSrc, ready: media.readyState, error: media.error?.message })), alert: document.querySelector('[role=alert]')?.textContent, time: document.querySelector('.preview-time')?.textContent }));
      };
      const original = AudioContext.prototype.createGain;
      let output;
      AudioContext.prototype.createGain = function () { output = original.call(this); return output; };
      try {
        await invoke('create_project');
        const tracks = await invoke('init_default_tracks');
        const assets = await invoke('import_assets', { paths: [${JSON.stringify(path)}] });
        const timeline = await invoke('add_clip_to_timeline', {
          assetId: assets[0].id, trackId: tracks.tracks.find(track => track.kind === 'Audio').id, timelineStartUs: 0,
        });
        const clip = timeline.tracks.flatMap(track => track.items).find(item => item.AudioClip).AudioClip;
        await invoke('update_item', { itemId: clip.id, patch: { kind: 'AudioClip', changes: { volume: 2, fade_in_us: 0, fade_out_us: 0 } } });
        await waitFor(() => output?.gain.value === 2 && document.querySelector('audio')?.readyState >= 2);
        const analyser = output.context.createAnalyser();
        output.connect(analyser);
        await output.context.resume();
        document.querySelector('.preview .preview-btn').click();
        await waitFor(() => document.querySelector('.preview .preview-btn')?.getAttribute('aria-label') === 'Pause sequence');
        const samples = new Float32Array(analyser.fftSize);
        await waitFor(() => {
          analyser.getFloatTimeDomainData(samples);
          return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length) > 0.03;
        });
        document.querySelector('.preview .preview-btn').click();
        await waitFor(() => document.querySelector('audio').paused);
        analyser.disconnect();
        await invoke('create_project');
        return { audio: true };
      } finally { AudioContext.prototype.createGain = original; }
    })()`,
    userGesture: true,
    returnByValue: true,
    awaitPromise: true,
  });
  if (!result.result?.result?.value?.audio)
    throw new Error(
      `Native preview audio check failed: ${JSON.stringify(result.result)}`,
    );
}
