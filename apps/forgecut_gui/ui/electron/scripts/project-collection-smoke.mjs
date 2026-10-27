import { spawnSync } from "node:child_process";
import { copyFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

export async function verifyProjectCollection(directory, send) {
  const source = join(directory, "collection-source.mp4");
  const original = join(directory, "collected-project");
  const moved = join(directory, "moved-collection");
  const output = join(directory, "collected-output.mp4");
  await copyFile(join(directory, "source-selection.mp4"), source);
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
        `Project collection failed: ${JSON.stringify(response.result)}`,
      );
  };
  const helpers = `
    const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const invoke = async (command, args) => { const response = await window.forgecut.invoke(command, args); if (!response.ok) throw new Error(response.error.message); await settle(); return response.value; };
    const waitJob = async job => { for (let attempt = 0; attempt < 400; attempt++) { const current = await invoke('get_media_job', { sessionId: job.sessionId, jobId: job.id }); if (current.status === 'completed') return current; if (['failed', 'cancelled'].includes(current.status)) throw new Error(JSON.stringify(current.result)); await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error('Collection job timed out'); };
  `;
  await evaluate(`(async () => { ${helpers}
    await invoke('create_project');
    await invoke('init_default_tracks');
    await invoke('update_project', { name: 'Captured collection', settings: { width: 32, height: 18, fps: 10 } });
    const assets = await invoke('import_assets', { paths: [${JSON.stringify(source)}] });
    const snapshot = await invoke('get_project_snapshot');
    const track = snapshot.project.timeline.tracks.find(track => track.kind === 'Video');
    await invoke('add_clip_to_timeline', { assetId: assets[0].id, trackId: track.id, timelineStartUs: 0 });
    await invoke('set_sequence_end', { endUs: 200000 });
    const ready = await invoke('get_project_snapshot');
    const job = await invoke('collect_project', { sessionId: ready.sessionId, expectedRevision: ready.revision, requestId: crypto.randomUUID(), directory: ${JSON.stringify(original)}, assetIds: [assets[0].id] });
    await invoke('update_project', { name: 'Manual edit after capture' });
    const before = JSON.stringify((await invoke('get_project_snapshot')).project);
    const completed = await waitJob(job);
    if (completed.result.value.copiedAssets !== 1 || completed.result.value.externalAssets !== 0) throw new Error('Collection copied the wrong asset set');
    if (JSON.stringify((await invoke('get_project_snapshot')).project) !== before) throw new Error('Collection changed the current editor');
    await invoke('create_project');
    return true;
  })()`);
  await rename(original, moved);
  await rm(source);
  await evaluate(`(async () => { ${helpers}
    await invoke('load_project', { path: ${JSON.stringify(join(moved, "project.forgecut"))} });
    const snapshot = await invoke('get_project_snapshot');
    if (snapshot.missingMedia.length || snapshot.project.name !== 'Captured collection') throw new Error('Moved collection lost its captured revision or media');
    await waitJob(await invoke('export_project', { outputPath: ${JSON.stringify(output)} }));
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
    throw new Error(`Collected export failed: ${probe.stdout} ${probe.stderr}`);
  console.log(
    "Native selected-media collection, unchanged manual edits, moved reopening without the original source and actual export verified",
  );
}
