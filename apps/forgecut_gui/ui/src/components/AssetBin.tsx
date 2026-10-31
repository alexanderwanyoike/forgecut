import { Eye, File, Film, Image, Library, Music2, Upload } from "lucide-react";
import { useState, useEffect } from "react";
import ActionButton from "./ActionButton";
import { invoke, open } from "../lib/bridge";
import type { GraphicResource } from "../../electron/shared/graphic-resources";
import type { Asset as ProjectAsset } from "../../electron/shared/ipc-contract";

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
  onReviewSource?: (assetId: string) => void;
  projectAssets?: ProjectAsset[];
  missingMedia?: string[];
  resources?: GraphicResource[];
}

export default function AssetBin({
  projectVersion,
  onReviewSource,
  projectAssets,
  missingMedia = [],
  resources = [],
}: AssetBinProps) {
  const [localAssets, setAssets] = useState<Asset[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const assets = projectAssets ?? localAssets;

  useEffect(() => {
    if (projectAssets) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const list = await invoke("get_assets");
        if (!cancelled) setAssets(list ?? []);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [projectVersion, projectAssets]);

  const handleImport = async () => {
    setImportError(null);
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: "Media",
          extensions: [
            "sbz",
            "mp4",
            "mkv",
            "avi",
            "mov",
            "webm",
            "mp3",
            "wav",
            "flac",
            "png",
            "jpg",
            "jpeg",
            "gif",
          ],
        },
      ],
    });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      try {
        const imported = await invoke("import_assets", { paths });
        if (!projectAssets) setAssets((prev) => [...prev, ...imported]);
      } catch (cause) {
        setImportError(cause instanceof Error ? cause.message : String(cause));
      }
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await invoke("remove_asset", { id });
      if (!projectAssets) setAssets((prev) => prev.filter((a) => a.id !== id));
    } catch {}
  };

  const handleRelink = async (id: string) => {
    const selected = await open<string | null>({ multiple: false });
    if (selected) {
      try {
        await invoke("relink_asset", { id, path: selected });
      } catch {}
    }
  };

  const formatDuration = (us: number): string => {
    const totalSec = Math.floor(us / 1_000_000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
  };

  const kindIcon = (kind: string) => {
    if (kind === "Video") return Film;
    if (kind === "Audio") return Music2;
    if (kind === "Image") return Image;
    return File;
  };

  return (
    <aside className="panel asset-bin">
      {importError && <p role="alert">{importError}</p>}
      <div className="panel-header">
        <span>
          <Library size={15} aria-hidden="true" />
          Assets
        </span>
        <span className="panel-count">
          {assets.length +
            resources.filter((resource) => resource.kind === "Image").length}
        </span>
      </div>
      <ActionButton icon={Upload} className="import-btn" onClick={handleImport}>
        Import Media
      </ActionButton>
      <div className="asset-list">
        {resources
          .filter((resource) => resource.kind === "Image")
          .map((resource) => (
            <div
              className="asset-item"
              key={resource.id}
              draggable
              onDragStart={(event) =>
                event.dataTransfer.setData(
                  "application/forgecut-resource",
                  resource.id,
                )
              }
            >
              <img
                alt=""
                width={48}
                height={32}
                style={{ objectFit: "contain" }}
                src={`forgecut-resource://resource/${resource.sha256}`}
              />
              <div className="asset-info">
                <div className="asset-name">{resource.name}</div>
                <div className="asset-meta">Graphic artwork</div>
              </div>
            </div>
          ))}
        {assets.length === 0 &&
          !resources.some((resource) => resource.kind === "Image") && (
            <div className="asset-empty">
              <Film size={28} strokeWidth={1.3} aria-hidden="true" />
              <strong>No media imported</strong>
              <p>
                Import video, audio or images.
                <br />
                Then drag them to a track.
              </p>
            </div>
          )}
        {assets.map((asset) => {
          const Icon = kindIcon(asset.kind);
          return (
            <div
              key={asset.id}
              className="asset-item"
              draggable={true}
              onDragStart={(e) => {
                e.dataTransfer?.setData(
                  "application/forgecut-asset",
                  JSON.stringify(asset),
                );
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                void handleRemove(asset.id);
              }}
            >
              <span className="asset-icon">
                <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
              </span>
              <div className="asset-info">
                <div className="asset-name" title={asset.name}>
                  {asset.name}
                </div>
                {missingMedia.includes(asset.id) && (
                  <div className="asset-meta">
                    Media missing{" "}
                    <ActionButton onClick={() => handleRelink(asset.id)}>
                      Relink
                    </ActionButton>
                  </div>
                )}
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
              {onReviewSource &&
                (asset.kind === "Video" || asset.kind === "Audio") && (
                  <ActionButton
                    icon={Eye}
                    iconOnly
                    tooltip={`Review source: ${asset.name}`}
                    disabled={
                      !asset.probe?.duration_us ||
                      missingMedia.includes(asset.id)
                    }
                    onClick={() => onReviewSource(asset.id)}
                  />
                )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
