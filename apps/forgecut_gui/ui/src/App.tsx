import { useState, useEffect, useRef, lazy, Suspense } from "react";
import McpStatus from "./components/McpStatus";
import { useEditingContext } from "./hooks/useEditingContext";
import { getItemData } from "./lib/timeline/items";
import { invoke, open, save } from "./lib/bridge";
import AssetBin from "./components/AssetBin";
import ExportDialog from "./components/ExportDialog";
import Inspector from "./components/Inspector";
import Preview from "./components/Preview";
import Timeline from "./components/Timeline";
import { useProject } from "./hooks/useProject";

const CodeWorkspace = lazy(() => import("./components/CodeWorkspace"));

export default function App() {
  const [showExport, setShowExport] = useState(false);
  const [playheadUs, setPlayheadUs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [sourceItemId, setSourceItemId] = useState<string | null>(null);
  const sourceClose = useRef<(() => Promise<boolean>) | null>(null);
  const selectClip = (id: string | null) => {
    setSelectedClipId(id);
    setSelectedLayerId(null);
  };
  const { snapshot, error, setError } = useProject();
  useEditingContext(snapshot, selectedClipId, playheadUs, selectedLayerId);
  const [recoveryPath, setRecoveryPath] = useState<string | null>(null);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const projectVersion = snapshot?.revision ?? 0;
  const projectName = snapshot?.project.name ?? "Untitled Project";
  const [theme, setTheme] = useState(
    () => localStorage.getItem("forgecut-theme") || "dark",
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("forgecut-theme", theme);
  }, [theme]);

  useEffect(() => {
    setSourceItemId(null);
    setPlayheadUs(0);
    setPlaying(false);
    selectClip(null);
    if (snapshot && snapshot.project.timeline.tracks.length === 0) {
      invoke("init_default_tracks").catch(() => {});
    }
  }, [snapshot?.sessionId]);

  useEffect(() => {
    setPlaying(false);
    if (snapshot)
      setSelectedClipId((id) =>
        id &&
        snapshot.project.timeline.tracks.some((track) =>
          track.items.some((item) => getItemData(item).id === id),
        )
          ? id
          : null,
      );
  }, [projectVersion]);

  useEffect(() => {
    const interval = setInterval(() => {
      void invoke("autosave").catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  const handleSave = async () => {
    setShowFileMenu(false);
    const filePath = await save({
      filters: [{ name: "ForgeCut Project", extensions: ["forgecut"] }],
      defaultPath: "project.forgecut",
    });
    if (!filePath) return;
    try {
      await invoke("save_project", { path: filePath });
    } catch (e) {
      console.error("save_project failed:", e);
    }
  };

  const handleOpen = async () => {
    setShowFileMenu(false);
    const filePath = await open({
      filters: [{ name: "ForgeCut Project", extensions: ["forgecut"] }],
      multiple: false,
    });
    if (!filePath) return;
    const path = Array.isArray(filePath) ? filePath[0] : filePath;
    if (sourceClose.current && !(await sourceClose.current())) return;
    try {
      await invoke("load_project", { path });
      setError(null);
      setRecoveryPath(null);
      setPlayheadUs(0);
      setPlaying(false);
      selectClip(null);
    } catch (e) {
      setError(`Could not open the project: ${String(e)}`);
      setRecoveryPath(path);
    }
  };

  const handleRecover = async () => {
    if (!recoveryPath) return;
    if (sourceClose.current && !(await sourceClose.current())) return;
    try {
      await invoke("recover_project", { path: recoveryPath });
      setError(null);
      setRecoveryPath(null);
    } catch (reason) {
      setError(`Could not open the recovery copy: ${String(reason)}`);
    }
  };

  return (
    <div
      className="shell"
      onClick={() => showFileMenu && setShowFileMenu(false)}
    >
      <header className="menu-bar">
        <div className="menu-items">
          <span
            className="menu-label"
            onClick={(e) => {
              e.stopPropagation();
              setShowFileMenu(!showFileMenu);
            }}
          >
            File
            {showFileMenu && (
              <div
                className="dropdown-menu"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="dropdown-item" onClick={handleOpen}>
                  Open Project...
                </div>
                <div className="dropdown-item" onClick={handleSave}>
                  Save Project...
                </div>
              </div>
            )}
          </span>
          <button
            className="preview-btn"
            disabled={!snapshot?.canUndo}
            onClick={() => invoke("undo").catch(() => {})}
          >
            Undo
          </button>
          <button
            className="preview-btn"
            disabled={!snapshot?.canRedo}
            onClick={() => invoke("redo").catch(() => {})}
          >
            Redo
          </button>
          <span className="menu-label" onClick={() => setShowExport(true)}>
            Export
          </span>
        </div>
        <button
          className="theme-toggle"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        >
          {theme === "dark" ? "Light" : "Dark"}
        </button>
        <McpStatus />
        <span className="project-name">{projectName}</span>
      </header>

      {error && (
        <div className="project-notice" role="alert">
          {error}
          {recoveryPath && (
            <button onClick={handleRecover}>Open recovery copy</button>
          )}
          <button
            onClick={() => {
              setError(null);
              setRecoveryPath(null);
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      <AssetBin
        projectVersion={projectVersion}
        projectAssets={snapshot?.project.assets}
        resources={snapshot?.project.resources}
        missingMedia={snapshot?.missingMedia}
      />

      {sourceItemId && snapshot ? (
        <Suspense
          fallback={
            <section className="panel preview">Loading code editor…</section>
          }
        >
          <CodeWorkspace
            key={`${snapshot.sessionId}:${sourceItemId}`}
            snapshot={snapshot}
            itemId={sourceItemId}
            onClose={() => setSourceItemId(null)}
            onRegisterClose={(guard) => {
              sourceClose.current = guard;
            }}
          />
        </Suspense>
      ) : (
        <Preview
          sessionId={snapshot?.sessionId}
          selectedClipId={selectedClipId}
          selectedLayerId={selectedLayerId}
          onGraphicSelection={(itemId, layerId) => {
            setSelectedClipId(itemId);
            setSelectedLayerId(layerId);
          }}
          project={snapshot?.project}
          playheadUs={playheadUs}
          playing={playing}
          onPlayingChange={setPlaying}
          onPlayheadChange={setPlayheadUs}
          projectVersion={projectVersion}
        />
      )}

      <Inspector
        onEditCode={async (itemId) => {
          if (
            sourceItemId &&
            sourceItemId !== itemId &&
            sourceClose.current &&
            !(await sourceClose.current())
          )
            return;
          setPlaying(false);
          setSourceItemId(itemId);
        }}
        selectedLayerId={selectedLayerId}
        onSelectedLayerChange={setSelectedLayerId}
        sessionId={snapshot?.sessionId}
        selectedClipId={selectedClipId}
        project={snapshot?.project}
        projectVersion={projectVersion}
      />

      <Timeline
        playheadUs={playheadUs}
        playing={playing}
        onPlayheadChange={setPlayheadUs}
        onPlayingChange={setPlaying}
        selectedClipId={selectedClipId}
        onSelectedClipChange={selectClip}
        projectVersion={projectVersion}
        projectTimeline={snapshot?.project.timeline}
        projectMediaVersion={JSON.stringify([
          snapshot?.sessionId,
          snapshot?.project.assets,
        ])}
      />

      <ExportDialog open={showExport} onClose={() => setShowExport(false)} />
    </div>
  );
}
