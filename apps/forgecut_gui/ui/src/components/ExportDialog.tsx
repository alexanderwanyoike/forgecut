import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";

interface RenderProgress {
  percent: number;
  frame: number;
  fps: number;
  speed: string;
  eta_seconds: number | null;
}

export default function ExportDialog(props: { onClose: () => void }) {
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const unlistenProgressRef = useRef<(() => void) | null>(null);
  const unlistenCompleteRef = useRef<(() => void) | null>(null);

  // Hide mpv X11 window on mount so it doesn't render above this dialog
  useEffect(() => {
    invoke("mpv_hide").catch(() => {});
    return () => {
      invoke("mpv_show").catch(() => {});
    };
  }, []);

  useEffect(() => {
    return () => {
      unlistenProgressRef.current?.();
      unlistenCompleteRef.current?.();
    };
  }, []);

  const handleExport = async () => {
    const filePath = await save({
      filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
      defaultPath: "export.mp4",
    });
    if (!filePath) return;

    setExporting(true);
    setError(null);

    unlistenProgressRef.current = await listen<RenderProgress>("export-progress", (event) => {
      setProgress(event.payload);
    });

    unlistenCompleteRef.current = await listen("export-complete", () => {
      setDone(true);
      setExporting(false);
      unlistenProgressRef.current?.();
      unlistenCompleteRef.current?.();
    });

    try {
      await invoke("export_project", { outputPath: filePath });
    } catch (e) {
      setError(String(e));
      setExporting(false);
      unlistenProgressRef.current?.();
      unlistenCompleteRef.current?.();
    }
  };

  return (
    <div className="export-dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget && !exporting) props.onClose(); }}>
      <div className="export-dialog">
        <div className="export-header">
          <h3>Export Project</h3>
          {!exporting && (
            <button className="close-btn" onClick={props.onClose}>&times;</button>
          )}
        </div>

        <div className="export-body">
          <div className="export-info">
            <div className="info-row"><span>Format:</span><span>MP4 (H.264 + AAC)</span></div>
            <div className="info-row"><span>Quality:</span><span>CRF 23</span></div>
            <div className="info-row"><span>Audio:</span><span>AAC 192kbps 48kHz</span></div>
          </div>

          {exporting && (
            <div className="export-progress">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress?.percent ?? 0}%` }} />
              </div>
              <div className="progress-stats">
                <span>{(progress?.percent ?? 0).toFixed(1)}%</span>
                <span>Frame {progress?.frame ?? 0} &bull; {(progress?.fps ?? 0).toFixed(1)} fps</span>
                {progress?.speed && <span>Speed: {progress.speed}</span>}
              </div>
            </div>
          )}

          {error && (
            <div className="export-error">{error}</div>
          )}

          {done && (
            <div className="export-success">Export complete!</div>
          )}
        </div>

        <div className="export-footer">
          {!exporting && !done && (
            <button className="btn-export" onClick={handleExport}>Export</button>
          )}
          {done && (
            <button className="btn-export" onClick={props.onClose}>Close</button>
          )}
        </div>
      </div>
    </div>
  );
}
