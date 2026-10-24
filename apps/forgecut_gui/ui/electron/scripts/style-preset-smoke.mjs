import { join } from "node:path";

export async function verifyStylePresets(directory, send) {
  const path = join(directory, "styles.forgecut");
  const response = await send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const invoke = async (command, args, sequenceId) => {
        const metadata = sequenceId ? { sessionId: (await window.forgecut.invoke('get_project_snapshot')).value.sessionId, sequenceId } : undefined;
        const response = await window.forgecut.invoke(command, args, metadata);
        if (!response.ok) throw new Error(response.error.message);
        return response.value;
      };
      const read = () => invoke('get_project_snapshot');
      await invoke('create_project');
      const root = (await read()).project.default_sequence.id;
      await invoke('add_graphic_item', { templateId: 'title-card', trackId: 'style-graphics', timelineStartUs: 0, durationUs: 1000000, props: { title: 'Project card', color: '#8293a4', font_size: 60 } }, root);
      const source = (await read()).project.timeline.tracks.flatMap(track => track.items).find(item => item.RemotionGraphic).RemotionGraphic;
      const preset = await invoke('save_style_preset', { sourceSequenceId: root, itemId: source.id, name: 'Project style', purpose: 'card' });
      const portrait = await invoke('create_sequence', { name: 'Styled portrait', settings: { width: 1080, height: 1920 } });
      await invoke('add_graphic_from_preset', { presetId: preset.id, trackId: 'portrait-style', timelineStartUs: 0, durationUs: 1000000, overrides: { title: 'Portrait wording' } }, portrait.id);
      const created = (await read()).project.sequences[0].timeline.tracks.flatMap(track => track.items).find(item => item.RemotionGraphic).RemotionGraphic;
      if (created.id === source.id || created.props.title !== 'Portrait wording' || Math.abs(created.props.font_size - 33.75) > 0.001 || created.props.color !== '#8293a4') throw new Error('Preset instance did not retain style, scale or overrides');
      await invoke('update_item', { itemId: created.id, patch: { kind: 'RemotionGraphic', changes: { props: { color: '#aabbcc' } } } }, portrait.id);
      const edited = (await read()).project;
      if (edited.style_presets[0].props.color !== '#8293a4' || edited.timeline.tracks.flatMap(track => track.items).find(item => item.RemotionGraphic).RemotionGraphic.props.color !== '#8293a4') throw new Error('Instance edit changed the saved style or source');
      await invoke('save_project', { path: ${JSON.stringify(path)} });
      await invoke('load_project', { path: ${JSON.stringify(path)} });
      if (JSON.stringify((await read()).project) !== JSON.stringify(edited)) throw new Error('Style project changed on reopen');
      await invoke('delete_style_preset', { presetId: preset.id });
      if ((await read()).project.style_presets.length !== 0) throw new Error('Style deletion did not finish');
      await invoke('undo');
      if (JSON.stringify((await read()).project) !== JSON.stringify(edited)) throw new Error('Style deletion did not undo exactly');
      await invoke('create_project');
      return true;
    })()`,
  });
  if (
    response.result?.exceptionDetails ||
    response.result?.result?.value !== true
  )
    throw new Error(
      `Project style workflow failed: ${JSON.stringify(response.result)}`,
    );
  console.log(
    "Project style saving, portrait scaling, instance overrides, reopen and deletion undo verified",
  );
}
