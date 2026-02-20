import { useState, useEffect } from "react";
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
  const [itemData, setItemData] = useState<any>(null);
  const [itemType, setItemType] = useState<string>("");
  const [settings, setSettings] = useState<ProjectSettings | null>(null);

  // Load project settings on mount
  useEffect(() => {
    (async () => {
      try {
        const s = await invoke<ProjectSettings>("get_project_settings");
        setSettings(s);
      } catch {
        // ignore
      }
    })();
  }, []);

  // Fetch item details when selection changes
  useEffect(() => {
    const id = props.selectedClipId;
    if (!id) {
      setItemData(null);
      setItemType("");
      return;
    }
    (async () => {
      try {
        const details = await invoke<any>("get_item_details", { itemId: id });
        const variant = Object.keys(details)[0];
        setItemType(variant);
        setItemData(details[variant]);
      } catch {
        setItemData(null);
        setItemType("");
      }
    })();
  }, [props.selectedClipId]);

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
    <aside className="panel inspector">
      <div className="panel-header">Inspector</div>
      <div className="inspector-body">
        {props.selectedClipId && itemData ? (
          <div className="inspector-section">
            <div className="inspector-section-title">{itemType}</div>

            {/* Common fields */}
            {itemData.asset_name && (
              <div className="inspector-row">
                <span className="inspector-label">Source</span>
                <span className="inspector-value">{itemData.asset_name}</span>
              </div>
            )}

            <div className="inspector-row">
              <span className="inspector-label">Position</span>
              <span className="inspector-value">
                {formatUs(itemData.timeline_start_us)}
              </span>
            </div>

            <div className="inspector-row">
              <span className="inspector-label">Duration</span>
              <span className="inspector-value">
                {itemType === "VideoClip" || itemType === "AudioClip"
                  ? formatUs(
                      itemData.source_out_us - itemData.source_in_us
                    )
                  : formatUs(itemData.duration_us)}
              </span>
            </div>

            {/* VideoClip-specific */}
            {itemType === "VideoClip" && (
              <>
                <div className="inspector-row">
                  <span className="inspector-label">In Point</span>
                  <span className="inspector-value">
                    {formatUs(itemData.source_in_us)}
                  </span>
                </div>
                <div className="inspector-row">
                  <span className="inspector-label">Out Point</span>
                  <span className="inspector-value">
                    {formatUs(itemData.source_out_us)}
                  </span>
                </div>
              </>
            )}

            {/* AudioClip-specific */}
            {itemType === "AudioClip" && (
              <>
                <div className="inspector-row">
                  <span className="inspector-label">In Point</span>
                  <span className="inspector-value">
                    {formatUs(itemData.source_in_us)}
                  </span>
                </div>
                <div className="inspector-row">
                  <span className="inspector-label">Out Point</span>
                  <span className="inspector-value">
                    {formatUs(itemData.source_out_us)}
                  </span>
                </div>
                <div className="inspector-row">
                  <span className="inspector-label">Volume</span>
                  <input
                    type="range"
                    className="inspector-slider"
                    min="0"
                    max="2"
                    step="0.01"
                    value={itemData.volume}
                    onInput={(e) =>
                      updateProperty("volume", parseFloat(e.currentTarget.value))
                    }
                  />
                  <span className="inspector-value-sm">
                    {(itemData.volume * 100).toFixed(0)}%
                  </span>
                </div>
              </>
            )}

            {/* TextOverlay-specific */}
            {itemType === "TextOverlay" && (
              <>
                <div className="inspector-row-col">
                  <span className="inspector-label">Text</span>
                  <input
                    type="text"
                    className="inspector-input"
                    value={itemData.text}
                    onChange={(e) =>
                      updateProperty("text", e.currentTarget.value)
                    }
                  />
                </div>
                <div className="inspector-row">
                  <span className="inspector-label">Font Size</span>
                  <input
                    type="number"
                    className="inspector-input-sm"
                    value={itemData.font_size}
                    onChange={(e) =>
                      updateProperty(
                        "font_size",
                        parseInt(e.currentTarget.value, 10)
                      )
                    }
                  />
                </div>
                <div className="inspector-row">
                  <span className="inspector-label">Color</span>
                  <input
                    type="color"
                    className="inspector-color"
                    value={itemData.color}
                    onInput={(e) =>
                      updateProperty("color", e.currentTarget.value)
                    }
                  />
                </div>
                <div className="inspector-row">
                  <span className="inspector-label">X</span>
                  <input
                    type="number"
                    className="inspector-input-sm"
                    value={itemData.x}
                    onChange={(e) =>
                      updateProperty("x", parseInt(e.currentTarget.value, 10))
                    }
                  />
                </div>
                <div className="inspector-row">
                  <span className="inspector-label">Y</span>
                  <input
                    type="number"
                    className="inspector-input-sm"
                    value={itemData.y}
                    onChange={(e) =>
                      updateProperty("y", parseInt(e.currentTarget.value, 10))
                    }
                  />
                </div>
              </>
            )}

            {/* ImageOverlay-specific */}
            {itemType === "ImageOverlay" && (
              <>
                <div className="inspector-row">
                  <span className="inspector-label">X</span>
                  <input
                    type="number"
                    className="inspector-input-sm"
                    value={itemData.x}
                    onChange={(e) =>
                      updateProperty("x", parseInt(e.currentTarget.value, 10))
                    }
                  />
                </div>
                <div className="inspector-row">
                  <span className="inspector-label">Y</span>
                  <input
                    type="number"
                    className="inspector-input-sm"
                    value={itemData.y}
                    onChange={(e) =>
                      updateProperty("y", parseInt(e.currentTarget.value, 10))
                    }
                  />
                </div>
                <div className="inspector-row">
                  <span className="inspector-label">Width</span>
                  <input
                    type="number"
                    className="inspector-input-sm"
                    value={itemData.width}
                    onChange={(e) =>
                      updateProperty(
                        "width",
                        parseInt(e.currentTarget.value, 10)
                      )
                    }
                  />
                </div>
                <div className="inspector-row">
                  <span className="inspector-label">Height</span>
                  <input
                    type="number"
                    className="inspector-input-sm"
                    value={itemData.height}
                    onChange={(e) =>
                      updateProperty(
                        "height",
                        parseInt(e.currentTarget.value, 10)
                      )
                    }
                  />
                </div>
                <div className="inspector-row">
                  <span className="inspector-label">Opacity</span>
                  <input
                    type="range"
                    className="inspector-slider"
                    min="0"
                    max="1"
                    step="0.01"
                    value={itemData.opacity}
                    onInput={(e) =>
                      updateProperty(
                        "opacity",
                        parseFloat(e.currentTarget.value)
                      )
                    }
                  />
                  <span className="inspector-value-sm">
                    {(itemData.opacity * 100).toFixed(0)}%
                  </span>
                </div>
              </>
            )}
          </div>
        ) : settings ? (
          <div className="inspector-section">
            <div className="inspector-section-title">Project Settings</div>
            <div className="inspector-row">
              <span className="inspector-label">Resolution</span>
              <span className="inspector-value">
                {settings.width} x {settings.height}
              </span>
            </div>
            <div className="inspector-row">
              <span className="inspector-label">FPS</span>
              <span className="inspector-value">{settings.fps}</span>
            </div>
            <div className="inspector-row">
              <span className="inspector-label">Sample Rate</span>
              <span className="inspector-value">{settings.sample_rate} Hz</span>
            </div>
          </div>
        ) : (
          <div className="inspector-empty">No selection</div>
        )}
      </div>
    </aside>
  );
}
