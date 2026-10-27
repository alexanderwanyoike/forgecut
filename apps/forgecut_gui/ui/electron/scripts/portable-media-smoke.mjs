import { spawnSync } from "node:child_process";
import { copyFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";

export async function verifyPortableMedia(directory, send) {
  const original = join(directory, "portable-project");
  const moved = join(directory, "moved-project");
  await mkdir(join(original, "media"), { recursive: true });
  await copyFile(
    join(directory, "source-selection.mp4"),
    join(original, "media", "clip.mp4"),
  );
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (
      response.result?.exceptionDetails ||
      response.result?.result?.value !== true
    )
      throw new Error(
        `Portable media failed: ${JSON.stringify(response.result)}`,
      );
  };
  const helpers = `
    const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const invoke = async (command, args) => { const result = await window.forgecut.invoke(command, args); if (!result.ok) throw new Error(result.error.message); await settle(); return result.value; };
  `;
  await evaluate(`(async () => { ${helpers}
    await invoke('create_project');
    await invoke('init_default_tracks');
    await invoke('update_project', { settings: { width: 32, height: 18, fps: 10 } });
    const assets = await invoke('import_assets', { paths: [${JSON.stringify(join(original, "media", "clip.mp4"))}] });
    const ready = await invoke('get_project_snapshot');
    const track = ready.project.timeline.tracks.find(track => track.kind === 'Video');
    await invoke('add_clip_to_timeline', { trackId: track.id, assetId: assets[0].id, timelineStartUs: 0 });
    await invoke('set_sequence_end', { endUs: 200000 });
    const before = JSON.stringify((await invoke('get_project_snapshot')).project);
    await invoke('save_project', { path: ${JSON.stringify(join(original, "edit.forgecut"))} });
    if (JSON.stringify((await invoke('get_project_snapshot')).project) !== before) throw new Error('Saving changed the current editor');
    await invoke('create_project');
    return true;
  })()`);
  await rename(original, moved);
  const output = join(directory, "moved-media.mp4");
  await evaluate(`(async () => { ${helpers}
    await invoke('load_project', { path: ${JSON.stringify(join(moved, "edit.forgecut"))} });
    const snapshot = await invoke('get_project_snapshot');
    if (snapshot.missingMedia.length || snapshot.project.assets[0].path !== ${JSON.stringify(join(moved, "media", "clip.mp4"))}) throw new Error('Moved media did not resolve from the project folder');
    const job = await invoke('export_project', { outputPath: ${JSON.stringify(output)} });
    let completed = false;
    for (let attempt = 0; attempt < 400; attempt++) {
      const current = await invoke('get_media_job', { sessionId: job.sessionId, jobId: job.id });
      if (current.status === 'completed') { completed = true; break; }
      if (['failed', 'cancelled'].includes(current.status)) throw new Error(JSON.stringify(current.result));
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (!completed) throw new Error('Moved project export timed out');
    await invoke('create_project');
    return true;
  })()`);
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-count_frames",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=nb_read_frames",
      "-of",
      "csv=p=0",
      output,
    ],
    { encoding: "utf8" },
  );
  if (probe.status !== 0 || probe.stdout.trim() !== "2")
    throw new Error(
      `Moved project output failed: ${probe.stdout} ${probe.stderr}`,
    );
  console.log(
    "Native save, moved project media resolution and actual two-frame export verified",
  );
}
