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
    "sine=frequency=440:sample_rate=48000:duration=10",
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
        throw new Error('Preview audio did not reach the expected state: ' + JSON.stringify({ captured: media && { connected: media.isConnected, paused: media.paused, time: media.currentTime }, output: !!output, gain: output?.gain.value, context: output?.context.state, button: document.querySelector('.preview-controls button[aria-label]')?.getAttribute('aria-label'), audio: [...document.querySelectorAll('audio')].map(media => ({ src: media.currentSrc, ready: media.readyState, paused: media.paused, time: media.currentTime, error: media.error?.message })), alert: document.querySelector('[role=alert]')?.textContent, time: document.querySelector('.preview-time')?.textContent }));
      };
      const original = AudioNode.prototype.connect;
      const graphs = new WeakMap();
      let output;
      let media;
      AudioNode.prototype.connect = function (destination, ...args) {
        if (this instanceof MediaElementAudioSourceNode && destination instanceof GainNode) graphs.set(this.mediaElement, destination);
        return original.call(this, destination, ...args);
      };
      try {
        await invoke('create_project');
        const tracks = await invoke('init_default_tracks');
        const assets = await invoke('import_assets', { paths: [${JSON.stringify(path)}] });
        const timeline = await invoke('add_clip_to_timeline', {
          assetId: assets[0].id, trackId: tracks.tracks.find(track => track.kind === 'Audio').id, timelineStartUs: 0,
        });
        const clip = timeline.tracks.flatMap(track => track.items).find(item => item.AudioClip).AudioClip;
        await invoke('update_item', { itemId: clip.id, patch: { kind: 'AudioClip', changes: { volume: 2, fade_in_us: 0, fade_out_us: 0 } } });
        await waitFor(() => {
          const current = document.querySelector('.preview audio');
          return current?.readyState >= 2 && graphs.get(current)?.gain.value === 2;
        });
        document.querySelector('.preview-controls button[aria-label]').click();
        await waitFor(() => {
          const current = document.querySelector('.preview audio');
          return current && !current.paused && document.querySelector('.preview-controls button[aria-label]')?.getAttribute('aria-label') === 'Pause sequence';
        });
        media = document.querySelector('.preview audio');
        output = graphs.get(media);
        const analyser = output.context.createAnalyser();
        output.connect(analyser);
        await output.context.resume();
        const samples = new Float32Array(analyser.fftSize);
        await waitFor(() => {
          analyser.getFloatTimeDomainData(samples);
          return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length) > 0.03;
        });
        document.querySelector('.preview-controls button[aria-label]').click();
        await waitFor(() => media.paused);
        analyser.disconnect();
        await invoke('create_project');
        return { audio: true };
      } finally { AudioNode.prototype.connect = original; }
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
