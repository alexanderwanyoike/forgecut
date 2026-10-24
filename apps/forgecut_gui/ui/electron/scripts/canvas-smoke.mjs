export async function verifyCanvas(send) {
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.result?.exceptionDetails)
      throw new Error(JSON.stringify(response.result.exceptionDetails));
    return response.result?.result?.value;
  };
  const before = await evaluate(`(async()=>{
    for(let attempt=0;attempt<200;attempt++) {
      const target=document.querySelector('button[aria-label="Select Title"]');
      if(target) {
        const snapshot=await window.forgecut.invoke('get_project_snapshot');
        if(!snapshot.ok)throw new Error(snapshot.error.message);
        const item=snapshot.value.project.timeline.tracks.flatMap(track=>track.items).find(item=>item.RemotionGraphic).RemotionGraphic;
        const box=target.getBoundingClientRect();
        return {project:snapshot.value.project,revision:snapshot.value.revision,id:item.id,x:box.left+10,y:box.top+10,scale:box.width/item.props.title_width};
      }
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    throw new Error('Canvas title hit target did not appear');
  })()`);
  if (!before?.scale)
    throw new Error("Canvas hit target has no measurable size");
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: before.x,
    y: before.y,
    button: "left",
    clickCount: 1,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: before.x + 20,
    y: before.y + 10,
    button: "left",
    buttons: 1,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: before.x + 20,
    y: before.y + 10,
    button: "left",
    clickCount: 1,
  });
  const after = await evaluate(`(async()=>{
    for(let attempt=0;attempt<200;attempt++) {
      const snapshot=await window.forgecut.invoke('get_project_snapshot');
      if(snapshot.ok && snapshot.value.revision>${before.revision})return snapshot.value;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    throw new Error('Canvas drag did not commit');
  })()`);
  const original = before.project.timeline.tracks
    .flatMap((track) => track.items)
    .find((item) => item.RemotionGraphic?.id === before.id).RemotionGraphic;
  const changed = after.project.timeline.tracks
    .flatMap((track) => track.items)
    .find((item) => item.RemotionGraphic?.id === before.id).RemotionGraphic;
  if (
    after.revision !== before.revision + 1 ||
    Math.abs(
      changed.props.title_x - original.props.title_x - 20 / before.scale,
    ) > 0.1 ||
    Math.abs(
      changed.props.title_y - original.props.title_y - 10 / before.scale,
    ) > 0.1
  )
    throw new Error(
      "Canvas drag did not preserve composition coordinates and one commit",
    );
  const restored = await evaluate(
    `(async()=>{const undo=await window.forgecut.invoke('undo');if(!undo.ok)throw new Error(undo.error.message);return (await window.forgecut.invoke('get_project_snapshot')).value.project;})()`,
  );
  if (JSON.stringify(restored) !== JSON.stringify(before.project))
    throw new Error("Canvas drag did not undo in one step");
}
