/** @vitest-environment node */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { componentVersion } from "../../backend/graphic-component";
import { AppState } from "../../backend/state";
import { EditingService } from "../../backend/editing-service";
import { startLocalBridge } from "../local-bridge";
import { callBridge } from "../sessions";
import { MAX_MESSAGE_BYTES } from "../contract";

it("reads five maximum-length escaped text properties within the authenticated transport bound", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgecut-style-bounds-"));
  const state = new AppState();
  const service = new EditingService(state);
  const activity: string[] = [];
  const bridge = await startLocalBridge(service, directory, (label) =>
    activity.push(label),
  );
  try {
    await service.execute("add_graphic_item", {
      templateId: "title-card",
      trackId: "graphics",
      timelineStartUs: 0,
      durationUs: 1000000,
    });
    state.executeProjectChange((project) => {
      const component = project.components![0];
      for (let index = 0; index < 5; index += 1)
        component.properties[`large_${index}`] = {
          id: randomUUID(),
          label: `Large text ${index}`,
          type: "text",
          default: "\0".repeat(32768),
        };
      component.version = componentVersion(component);
      const item = project.timeline.tracks[0].items[0];
      if ("RemotionGraphic" in item)
        item.RemotionGraphic.component_version = component.version;
    });
    const item = state.project.timeline.tracks[0].items[0];
    if (!("RemotionGraphic" in item)) throw new Error("Missing card");
    const saved = await service.execute("save_style_preset", {
      sourceSequenceId: state.project.default_sequence!.id,
      itemId: item.RemotionGraphic.id,
      name: "Large style",
      purpose: "card",
    });
    expect(saved.ok).toBe(true);
    const preset = state.project.style_presets![0];
    const offset = Object.keys(preset.props).indexOf("large_0");
    const read = await callBridge(bridge.session, {
      action: "style-preset-values",
      sessionId: state.sessionId,
      presetId: preset.id,
      offset,
      limit: 5,
    });
    expect(read.ok).toBe(true);
    expect(activity.at(-1)).toBe("Read saved style values");
    if (!read.ok) throw new Error(read.error.message);
    const values = (read.value as { props: Record<string, string> }).props;
    expect(Object.keys(values)).toHaveLength(5);
    expect(Object.values(values).every((value) => value.length === 32768)).toBe(
      true,
    );
    expect(Buffer.byteLength(JSON.stringify(read))).toBeLessThan(
      MAX_MESSAGE_BYTES,
    );
  } finally {
    await bridge.close();
    await service.jobs.close();
    await service.closeGraphicsPreview();
    await rm(directory, { recursive: true, force: true });
  }
});
