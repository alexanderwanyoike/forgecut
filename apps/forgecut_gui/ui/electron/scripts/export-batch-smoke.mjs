import { spawnSync } from "node:child_process";
import { join } from "node:path";

export async function verifyExportBatches(directory, send) {
  const output = join(directory, "durable-batch");
  const response = await send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const invoke = async (name, args, metadata) => { const result = await window.forgecut.invoke(name, args, metadata); if (!result.ok) throw new Error(result.error.message); await settle(); return result.value; };
      await invoke('create_project');
      await invoke('update_project', { name: 'Saved batch', settings: { width: 32, height: 18, fps: 10 } });
      await invoke('set_sequence_end', { endUs: 200000 });
      await invoke('create_sequence', { name: 'Portrait', settings: { width: 18, height: 32 } });
      const captured = await invoke('get_project_snapshot');
      const ids = [captured.project.default_sequence.id, captured.project.sequences[0].id];
      await invoke('set_sequence_end', { endUs: 200000 }, { sequenceId: ids[1] });
      const ready = await invoke('get_project_snapshot');
      const directory = ${JSON.stringify(output)};
      const batch = await invoke('create_export_batch', { sessionId: ready.sessionId, expectedRevision: ready.revision, directory, sequenceIds: ids, preset: 'webm' });
      await invoke('update_project', { name: 'Manual changes after capture', settings: { width: 64, height: 36 } });
      const before = JSON.stringify((await invoke('get_project_snapshot')).project);
      await invoke('resume_export_batch', { directory, batchId: batch.id });
      let result;
      for (let attempt = 0; attempt < 400; attempt++) {
        result = await invoke('get_export_batch', { directory });
        if (!result.active) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (result.active || result.entries.some(entry => entry.status !== 'completed')) throw new Error('Native batch did not finish: ' + JSON.stringify(result));
      const repeated = await invoke('resume_export_batch', { directory, batchId: batch.id });
      if (repeated.active || repeated.progress !== 1) throw new Error('Completed batch was restarted');
      if (JSON.stringify((await invoke('get_project_snapshot')).project) !== before) throw new Error('Batch changed the current project');
      await invoke('create_project');
      return result.entries.map(entry => entry.outputFile);
    })()`,
  });
  if (
    response.result?.exceptionDetails ||
    response.result?.result?.value?.length !== 2
  )
    throw new Error(
      `Native export batch failed: ${JSON.stringify(response.result)}`,
    );
  for (const [index, file] of response.result.result.value.entries()) {
    const probe = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-count_frames",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,width,height,nb_read_frames",
        "-of",
        "json",
        join(output, file),
      ],
      { encoding: "utf8" },
    );
    if (probe.status !== 0) throw new Error(probe.stderr);
    const stream = JSON.parse(probe.stdout).streams[0];
    if (
      stream.codec_name !== "vp9" ||
      stream.width !== (index ? 18 : 32) ||
      stream.height !== (index ? 32 : 18) ||
      stream.nb_read_frames !== "2"
    )
      throw new Error(
        `Incorrect captured batch output: ${JSON.stringify(stream)}`,
      );
  }
  console.log(
    "Native durable batch capture, serial landscape/portrait exports, completed-output skipping and unchanged editor verified",
  );
}
