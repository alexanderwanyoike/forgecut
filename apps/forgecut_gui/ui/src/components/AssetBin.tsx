import { useState, useEffect } from "react";
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

interface AssetBinProps {
  projectVersion: number;
}

export default function AssetBin({ projectVersion }: AssetBinProps) {
  const [assets, setAssets] = useState<Asset[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const list = await invoke<Asset[]>("get_assets");
        setAssets(list ?? []);
      } catch (_) {}
    })();
  }, [projectVersion]);

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
    <aside className="panel asset-bin">
      <div className="panel-header">Assets</div>
      <button className="import-btn" onClick={handleImport}>Import Media</button>
      <div className="asset-list">
        {assets.map((asset) => (
          <div
            key={asset.id}
            className="asset-item"
            draggable={true}
            onDragStart={(e) => {
              e.dataTransfer?.setData("application/forgecut-asset", JSON.stringify(asset));
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              handleRemove(asset.id);
            }}
          >
            <span className="asset-icon">{kindIcon(asset.kind)}</span>
            <div className="asset-info">
              <div className="asset-name">{asset.name}</div>
              <div className="asset-meta">
                {asset.probe && (
                  <>
                    {asset.probe.width && asset.probe.height
                      ? `${asset.probe.width}x${asset.probe.height}`
                      : ""}
                    {asset.probe.duration_us
                      ? ` \u2022 ${formatDuration(asset.probe.duration_us)}`
                      : ""}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
