import { createSignal, Show, onCleanup } from "solid-js";
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
  const [exporting, setExporting] = createSignal(false);
  const [progress, setProgress] = createSignal<RenderProgress | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [done, setDone] = createSignal(false);

  let unlistenProgress: (() => void) | null = null;
  let unlistenComplete: (() => void) | null = null;

  onCleanup(() => {
    unlistenProgress?.();
    unlistenComplete?.();
  });

  const handleExport = async () => {
    const filePath = await save({
      filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
      defaultPath: "export.mp4",
    });
    if (!filePath) return;

    setExporting(true);
    setError(null);

    unlistenProgress = await listen<RenderProgress>("export-progress", (event) => {
      setProgress(event.payload);
    });

    unlistenComplete = await listen("export-complete", () => {
      setDone(true);
      setExporting(false);
      unlistenProgress?.();
      unlistenComplete?.();
    });

    try {
      await invoke("export_project", { outputPath: filePath });
    } catch (e) {
      setError(String(e));
      setExporting(false);
      unlistenProgress?.();
      unlistenComplete?.();
    }
  };

  return (
    <div class="export-dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget && !exporting()) props.onClose(); }}>
      <div class="export-dialog">
        <div class="export-header">
          <h3>Export Project</h3>
          <Show when={!exporting()}>
            <button class="close-btn" onClick={props.onClose}>&times;</button>
          </Show>
        </div>

        <div class="export-body">
          <div class="export-info">
            <div class="info-row"><span>Format:</span><span>MP4 (H.264 + AAC)</span></div>
            <div class="info-row"><span>Quality:</span><span>CRF 23</span></div>
            <div class="info-row"><span>Audio:</span><span>AAC 192kbps 48kHz</span></div>
          </div>

          <Show when={exporting()}>
            <div class="export-progress">
              <div class="progress-bar">
                <div class="progress-fill" style={{ width: `${progress()?.percent ?? 0}%` }} />
              </div>
              <div class="progress-stats">
                <span>{(progress()?.percent ?? 0).toFixed(1)}%</span>
                <span>Frame {progress()?.frame ?? 0} &bull; {(progress()?.fps ?? 0).toFixed(1)} fps</span>
                <Show when={progress()?.speed}><span>Speed: {progress()?.speed}</span></Show>
              </div>
            </div>
          </Show>

          <Show when={error()}>
            <div class="export-error">{error()}</div>
          </Show>

          <Show when={done()}>
            <div class="export-success">Export complete!</div>
          </Show>
        </div>

        <div class="export-footer">
          <Show when={!exporting() && !done()}>
            <button class="btn-export" onClick={handleExport}>Export</button>
          </Show>
          <Show when={done()}>
            <button class="btn-export" onClick={props.onClose}>Close</button>
          </Show>
        </div>
      </div>
    </div>
  );
}
