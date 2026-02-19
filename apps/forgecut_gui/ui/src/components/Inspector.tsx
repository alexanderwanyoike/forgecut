import { createSignal, createEffect, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
  sample_rate: number;
}

interface InspectorProps {
  selectedClipId: string | null;
}

export default function Inspector(props: InspectorProps) {
  const [itemData, setItemData] = createSignal<any>(null);
  const [itemType, setItemType] = createSignal<string>("");
  const [settings, setSettings] = createSignal<ProjectSettings | null>(null);

  // Load project settings
  createEffect(async () => {
    try {
      const s = await invoke<ProjectSettings>("get_project_settings");
      setSettings(s);
    } catch {
      // ignore
    }
  });

  // Fetch item details when selection changes
  createEffect(async () => {
    const id = props.selectedClipId;
    if (!id) {
      setItemData(null);
      setItemType("");
      return;
    }
    try {
      const details = await invoke<any>("get_item_details", { itemId: id });
      const variant = Object.keys(details)[0];
      setItemType(variant);
      setItemData(details[variant]);
    } catch {
      setItemData(null);
      setItemType("");
    }
  });

  const updateProperty = async (property: string, value: any) => {
    const id = props.selectedClipId;
    if (!id) return;
    try {
      await invoke("update_item_property", {
        itemId: id,
        property,
        value,
      });
      // Refresh item data
      const details = await invoke<any>("get_item_details", { itemId: id });
      const variant = Object.keys(details)[0];
      setItemType(variant);
      setItemData(details[variant]);
    } catch (err) {
      console.error("update_item_property failed:", err);
    }
  };

  const formatUs = (us: number): string => {
    const totalSec = us / 1_000_000;
    const min = Math.floor(totalSec / 60);
    const sec = (totalSec % 60).toFixed(2);
    return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
  };

  return (
    <aside class="panel inspector">
      <div class="panel-header">Inspector</div>
      <div class="inspector-body">
        <Show
          when={props.selectedClipId && itemData()}
          fallback={
            <Show
              when={settings()}
              fallback={<div class="inspector-empty">No selection</div>}
            >
              {(s) => (
                <div class="inspector-section">
                  <div class="inspector-section-title">Project Settings</div>
                  <div class="inspector-row">
                    <span class="inspector-label">Resolution</span>
                    <span class="inspector-value">
                      {s().width} x {s().height}
                    </span>
                  </div>
                  <div class="inspector-row">
                    <span class="inspector-label">FPS</span>
                    <span class="inspector-value">{s().fps}</span>
                  </div>
                  <div class="inspector-row">
                    <span class="inspector-label">Sample Rate</span>
                    <span class="inspector-value">{s().sample_rate} Hz</span>
                  </div>
                </div>
              )}
            </Show>
          }
        >
          <div class="inspector-section">
            <div class="inspector-section-title">{itemType()}</div>

            {/* Common fields */}
            <Show when={itemData().asset_name}>
              <div class="inspector-row">
                <span class="inspector-label">Source</span>
                <span class="inspector-value">{itemData().asset_name}</span>
              </div>
            </Show>

            <div class="inspector-row">
              <span class="inspector-label">Position</span>
              <span class="inspector-value">
                {formatUs(itemData().timeline_start_us)}
              </span>
            </div>

            <div class="inspector-row">
              <span class="inspector-label">Duration</span>
              <span class="inspector-value">
                {itemType() === "VideoClip" || itemType() === "AudioClip"
                  ? formatUs(
                      itemData().source_out_us - itemData().source_in_us
                    )
                  : formatUs(itemData().duration_us)}
              </span>
            </div>

            {/* VideoClip-specific */}
            <Show when={itemType() === "VideoClip"}>
              <div class="inspector-row">
                <span class="inspector-label">In Point</span>
                <span class="inspector-value">
                  {formatUs(itemData().source_in_us)}
                </span>
              </div>
              <div class="inspector-row">
                <span class="inspector-label">Out Point</span>
                <span class="inspector-value">
                  {formatUs(itemData().source_out_us)}
                </span>
              </div>
            </Show>

            {/* AudioClip-specific */}
            <Show when={itemType() === "AudioClip"}>
              <div class="inspector-row">
                <span class="inspector-label">In Point</span>
                <span class="inspector-value">
                  {formatUs(itemData().source_in_us)}
                </span>
              </div>
              <div class="inspector-row">
                <span class="inspector-label">Out Point</span>
                <span class="inspector-value">
                  {formatUs(itemData().source_out_us)}
                </span>
              </div>
              <div class="inspector-row">
                <span class="inspector-label">Volume</span>
                <input
                  type="range"
                  class="inspector-slider"
                  min="0"
                  max="2"
                  step="0.01"
                  value={itemData().volume}
                  onInput={(e) =>
                    updateProperty("volume", parseFloat(e.currentTarget.value))
                  }
                />
                <span class="inspector-value-sm">
                  {(itemData().volume * 100).toFixed(0)}%
                </span>
              </div>
            </Show>

            {/* TextOverlay-specific */}
            <Show when={itemType() === "TextOverlay"}>
              <div class="inspector-row-col">
                <span class="inspector-label">Text</span>
                <input
                  type="text"
                  class="inspector-input"
                  value={itemData().text}
                  onChange={(e) =>
                    updateProperty("text", e.currentTarget.value)
                  }
                />
              </div>
              <div class="inspector-row">
                <span class="inspector-label">Font Size</span>
                <input
                  type="number"
                  class="inspector-input-sm"
                  value={itemData().font_size}
                  onChange={(e) =>
                    updateProperty(
                      "font_size",
                      parseInt(e.currentTarget.value, 10)
                    )
                  }
                />
              </div>
              <div class="inspector-row">
                <span class="inspector-label">Color</span>
                <input
                  type="color"
                  class="inspector-color"
                  value={itemData().color}
                  onInput={(e) =>
                    updateProperty("color", e.currentTarget.value)
                  }
                />
              </div>
              <div class="inspector-row">
                <span class="inspector-label">X</span>
                <input
                  type="number"
                  class="inspector-input-sm"
                  value={itemData().x}
                  onChange={(e) =>
                    updateProperty("x", parseInt(e.currentTarget.value, 10))
                  }
                />
              </div>
              <div class="inspector-row">
                <span class="inspector-label">Y</span>
                <input
                  type="number"
                  class="inspector-input-sm"
                  value={itemData().y}
                  onChange={(e) =>
                    updateProperty("y", parseInt(e.currentTarget.value, 10))
                  }
                />
              </div>
            </Show>

            {/* ImageOverlay-specific */}
            <Show when={itemType() === "ImageOverlay"}>
              <div class="inspector-row">
                <span class="inspector-label">X</span>
                <input
                  type="number"
                  class="inspector-input-sm"
                  value={itemData().x}
                  onChange={(e) =>
                    updateProperty("x", parseInt(e.currentTarget.value, 10))
                  }
                />
              </div>
              <div class="inspector-row">
                <span class="inspector-label">Y</span>
                <input
                  type="number"
                  class="inspector-input-sm"
                  value={itemData().y}
                  onChange={(e) =>
                    updateProperty("y", parseInt(e.currentTarget.value, 10))
                  }
                />
              </div>
              <div class="inspector-row">
                <span class="inspector-label">Width</span>
                <input
                  type="number"
                  class="inspector-input-sm"
                  value={itemData().width}
                  onChange={(e) =>
                    updateProperty(
                      "width",
                      parseInt(e.currentTarget.value, 10)
                    )
                  }
                />
              </div>
              <div class="inspector-row">
                <span class="inspector-label">Height</span>
                <input
                  type="number"
                  class="inspector-input-sm"
                  value={itemData().height}
                  onChange={(e) =>
                    updateProperty(
                      "height",
                      parseInt(e.currentTarget.value, 10)
                    )
                  }
                />
              </div>
              <div class="inspector-row">
                <span class="inspector-label">Opacity</span>
                <input
                  type="range"
                  class="inspector-slider"
                  min="0"
                  max="1"
                  step="0.01"
                  value={itemData().opacity}
                  onInput={(e) =>
                    updateProperty(
                      "opacity",
                      parseFloat(e.currentTarget.value)
                    )
                  }
                />
                <span class="inspector-value-sm">
                  {(itemData().opacity * 100).toFixed(0)}%
                </span>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </aside>
  );
}
