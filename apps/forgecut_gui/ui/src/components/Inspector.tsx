import { useState, useEffect, useRef } from "react";
import { getItemData } from "../lib/timeline/items";
import { invoke, invokeGrouped } from "../lib/bridge";
import type {
  AudioSettings,
  ItemPatch,
  Project,
  ProjectSettings,
  TimelineItem,
} from "../../electron/shared/ipc-contract";
import PropertyInput from "./PropertyInput";
import ClipAudioProperties from "./ClipAudioProperties";

interface InspectorProps {
  selectedClipId: string | null;
  project?: Project;
  projectVersion?: number;
}

export default function Inspector({
  selectedClipId,
  project,
  projectVersion,
}: InspectorProps) {
  const [details, setDetails] = useState<TimelineItem | null>(null);
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const group = useRef(crypto.randomUUID());
  const item = project
    ? (project.timeline.tracks
        .flatMap((track) => track.items)
        .find((candidate) => getItemData(candidate).id === selectedClipId) ??
      null)
    : details;
  const projectSettings = project?.settings ?? settings;

  useEffect(() => {
    if (project) return undefined;
    let cancelled = false;
    invoke("get_project_settings")
      .then((value) => {
        if (!cancelled) setSettings(value);
      })
      .catch(() => {});
    if (!selectedClipId) setDetails(null);
    else
      invoke("get_item_details", { itemId: selectedClipId })
        .then((value) => {
          if (!cancelled) setDetails(value);
        })
        .catch(() => {
          if (!cancelled) setDetails(null);
        });
    return () => {
      cancelled = true;
    };
  }, [selectedClipId, projectVersion, project]);

  const update = async (patch: ItemPatch) => {
    if (!selectedClipId) return;
    try {
      await invokeGrouped(group.current, "update_item", {
        itemId: selectedClipId,
        patch,
      });
      if (!project)
        setDetails(
          await invoke("get_item_details", { itemId: selectedClipId }),
        );
    } catch {}
  };
  const updateSettings = async (changes: Partial<ProjectSettings>) => {
    try {
      await invokeGrouped(group.current, "update_project", {
        settings: changes,
      });
    } catch {}
  };
  const numberField = (
    label: string,
    value: number,
    change: (value: number) => void | Promise<void>,
    min?: number,
  ) => (
    <label className="inspector-row" key={label}>
      <span className="inspector-label">{label}</span>
      <PropertyInput
        type="number"
        className="inspector-input-sm"
        value={value}
        min={min}
        onValueChange={(raw) => {
          if (raw === "") return;
          const next = Number(raw);
          if (Number.isFinite(next) && (min === undefined || next >= min))
            void change(next);
        }}
      />
    </label>
  );
  const text = item && "TextOverlay" in item ? item.TextOverlay : null;
  const image = item && "ImageOverlay" in item ? item.ImageOverlay : null;
  let clipAudio: {
    kind: "VideoClip" | "AudioClip";
    settings: AudioSettings;
  } | null = null;
  if (item && "VideoClip" in item)
    clipAudio = { kind: "VideoClip", settings: item.VideoClip };
  if (item && "AudioClip" in item)
    clipAudio = { kind: "AudioClip", settings: item.AudioClip };
  const data = item
    ? (Object.values(item)[0] as {
        timeline_start_us: number;
        source_in_us?: number;
        source_out_us?: number;
        duration_us?: number;
        asset_id?: string;
      })
    : null;
  const asset = project?.assets.find(
    (candidate) => candidate.id === data?.asset_id,
  );

  const settingsView = projectSettings ? (
    <div className="inspector-section">
      <div className="inspector-section-title">Project Settings</div>
      {project && (
        <label className="inspector-row">
          <span className="inspector-label">Name</span>
          <PropertyInput
            className="inspector-input"
            value={project.name}
            onValueChange={(name) => {
              invokeGrouped(group.current, "update_project", {
                name,
              }).catch(() => {});
            }}
          />
        </label>
      )}
      {project && (
        <label className="inspector-row">
          <span className="inspector-label">Sequence end (s)</span>
          <PropertyInput
            type="number"
            className="inspector-input-sm"
            min="0.001"
            step="0.1"
            placeholder="Automatic"
            value={
              project.timeline.duration_us === undefined
                ? ""
                : project.timeline.duration_us / 1000000
            }
            onValueChange={(raw) => {
              const seconds = Number(raw);
              if (raw === "" || (Number.isFinite(seconds) && seconds > 0)) {
                void invokeGrouped(group.current, "set_sequence_end", {
                  endUs: raw === "" ? null : Math.round(seconds * 1000000),
                }).catch(() => {});
              }
            }}
          />
        </label>
      )}
      {numberField(
        "Width",
        projectSettings.width,
        (width) => updateSettings({ width }),
        1,
      )}
      {numberField(
        "Height",
        projectSettings.height,
        (height) => updateSettings({ height }),
        1,
      )}
      {numberField(
        "FPS",
        projectSettings.fps,
        (fps) => updateSettings({ fps }),
        1,
      )}
      {numberField(
        "Sample Rate",
        projectSettings.sample_rate,
        (sample_rate) => updateSettings({ sample_rate }),
        1,
      )}
    </div>
  ) : (
    <div className="inspector-empty">No selection</div>
  );

  return (
    <aside className="panel inspector">
      <div className="panel-header">Inspector</div>
      <div
        className="inspector-body"
        onFocusCapture={() => {
          group.current = crypto.randomUUID();
        }}
        onPointerDownCapture={() => {
          group.current = crypto.randomUUID();
        }}
      >
        {item && data ? (
          <div className="inspector-section">
            <div className="inspector-section-title">
              {Object.keys(item)[0]}
            </div>
            {asset && (
              <div className="inspector-row">
                <span className="inspector-label">Asset</span>
                <span className="inspector-value">{asset.name}</span>
              </div>
            )}
            <div className="inspector-row">
              <span className="inspector-label">Start</span>
              <span className="inspector-value">
                {(data.timeline_start_us / 1_000_000).toFixed(2)}s
              </span>
            </div>
            <div className="inspector-row">
              <span className="inspector-label">Duration</span>
              <span className="inspector-value">
                {(
                  (data.duration_us ??
                    data.source_out_us! - data.source_in_us!) / 1_000_000
                ).toFixed(2)}
                s
              </span>
            </div>
            {text && (
              <>
                <label className="inspector-row">
                  <span className="inspector-label">Text</span>
                  <PropertyInput
                    className="inspector-input"
                    value={text.text}
                    onValueChange={(value) =>
                      update({ kind: "TextOverlay", changes: { text: value } })
                    }
                  />
                </label>
                {numberField(
                  "Font Size",
                  text.font_size,
                  (font_size) =>
                    update({ kind: "TextOverlay", changes: { font_size } }),
                  1,
                )}
                <label className="inspector-row">
                  <span className="inspector-label">Color</span>
                  <input
                    type="color"
                    className="inspector-color"
                    value={text.color}
                    onChange={(event) =>
                      update({
                        kind: "TextOverlay",
                        changes: { color: event.currentTarget.value },
                      })
                    }
                  />
                </label>
                {numberField("X", text.x, (x) =>
                  update({ kind: "TextOverlay", changes: { x } }),
                )}
                {numberField("Y", text.y, (y) =>
                  update({ kind: "TextOverlay", changes: { y } }),
                )}
              </>
            )}
            {image && (
              <>
                {numberField("X", image.x, (x) =>
                  update({ kind: "ImageOverlay", changes: { x } }),
                )}
                {numberField("Y", image.y, (y) =>
                  update({ kind: "ImageOverlay", changes: { y } }),
                )}
                {numberField(
                  "Width",
                  image.width,
                  (width) =>
                    update({ kind: "ImageOverlay", changes: { width } }),
                  1,
                )}
                {numberField(
                  "Height",
                  image.height,
                  (height) =>
                    update({ kind: "ImageOverlay", changes: { height } }),
                  1,
                )}
                <label className="inspector-row">
                  <span className="inspector-label">Opacity</span>
                  <input
                    type="range"
                    className="inspector-slider"
                    min="0"
                    max="1"
                    step="0.01"
                    value={image.opacity}
                    onChange={(event) =>
                      update({
                        kind: "ImageOverlay",
                        changes: { opacity: Number(event.currentTarget.value) },
                      })
                    }
                  />
                </label>
              </>
            )}
            {clipAudio && (
              <ClipAudioProperties {...clipAudio} update={update} />
            )}
          </div>
        ) : (
          settingsView
        )}
      </div>
    </aside>
  );
}
