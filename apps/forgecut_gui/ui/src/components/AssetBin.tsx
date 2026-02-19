import { createSignal, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

interface Asset {
  id: string;
  name: string;
  path: string;
  kind: string;
  probe: {
    duration_us: number;
    width: number;
    height: number;
    fps: number;
    codec: string;
  } | null;
}

export default function AssetBin() {
  const [assets, setAssets] = createSignal<Asset[]>([]);

  const handleImport = async () => {
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: "Media",
          extensions: [
            "mp4", "mkv", "avi", "mov", "webm",
            "mp3", "wav", "flac",
            "png", "jpg", "jpeg", "gif",
          ],
        },
      ],
    });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      const imported = await invoke<Asset[]>("import_assets", { paths });
      setAssets((prev) => [...prev, ...imported]);
    }
  };

  const handleRemove = async (id: string) => {
    await invoke("remove_asset", { id });
    setAssets((prev) => prev.filter((a) => a.id !== id));
  };

  const formatDuration = (us: number): string => {
    const totalSec = Math.floor(us / 1_000_000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
  };

  const kindIcon = (kind: string): string => {
    switch (kind) {
      case "Video": return "\uD83C\uDFAC";
      case "Audio": return "\uD83C\uDFB5";
      case "Image": return "\uD83D\uDDBC";
      default: return "\uD83D\uDCC4";
    }
  };

  return (
    <aside class="panel asset-bin">
      <div class="panel-header">Assets</div>
      <button class="import-btn" onClick={handleImport}>Import Media</button>
      <div class="asset-list">
        <For each={assets()}>
          {(asset) => (
            <div
              class="asset-item"
              draggable={true}
              onDragStart={(e) => {
                e.dataTransfer?.setData("application/forgecut-asset", JSON.stringify(asset));
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                handleRemove(asset.id);
              }}
            >
              <span class="asset-icon">{kindIcon(asset.kind)}</span>
              <div class="asset-info">
                <div class="asset-name">{asset.name}</div>
                <div class="asset-meta">
                  <Show when={asset.probe}>
                    {asset.probe?.width && asset.probe.height
                      ? `${asset.probe.width}x${asset.probe.height}`
                      : ""}
                    {asset.probe?.duration_us
                      ? ` \u2022 ${formatDuration(asset.probe.duration_us)}`
                      : ""}
                  </Show>
                </div>
              </div>
            </div>
          )}
        </For>
      </div>
    </aside>
  );
}
