import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import AssetBin from "./components/AssetBin";
import ExportDialog from "./components/ExportDialog";
import Inspector from "./components/Inspector";
import Preview from "./components/Preview";
import Timeline from "./components/Timeline";

export default function App() {
  const [showExport, setShowExport] = useState(false);
  const [playheadUs, setPlayheadUs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("Untitled Project");
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [projectVersion, setProjectVersion] = useState(0);
  const [theme, setTheme] = useState(() => localStorage.getItem("forgecut-theme") || "dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("forgecut-theme", theme);
  }, [theme]);

  useEffect(() => {
    const interval = setInterval(async () => {
      try { await invoke("autosave"); } catch (_) {}
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
      setProjectName(filePath.split("/").pop()?.replace(".forgecut", "") || "Project");
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
    try {
      await invoke("load_project", { path: filePath });
      setProjectName(
        (filePath as string).split("/").pop()?.replace(".forgecut", "") || "Project"
      );
      setPlayheadUs(0);
      setPlaying(false);
      setSelectedClipId(null);
      setProjectVersion((v) => v + 1);
    } catch (e) {
      console.error("load_project failed:", e);
    }
  };

  return (
    <div className="shell" onClick={() => showFileMenu && setShowFileMenu(false)}>
      <header className="menu-bar">
        <div className="menu-items">
          <span
            className="menu-label"
            onClick={(e) => { e.stopPropagation(); setShowFileMenu(!showFileMenu); }}
          >
            File
            {showFileMenu && (
              <div className="dropdown-menu" onClick={(e) => e.stopPropagation()}>
                <div className="dropdown-item" onClick={handleOpen}>Open Project...</div>
                <div className="dropdown-item" onClick={handleSave}>Save Project...</div>
              </div>
            )}
          </span>
          <span className="menu-label">Edit</span>
          <span className="menu-label" onClick={() => setShowExport(true)}>Export</span>
        </div>
        <button className="theme-toggle" onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "Light" : "Dark"}
        </button>
        <span className="project-name">{projectName}</span>
      </header>

      <AssetBin projectVersion={projectVersion} />

      <Preview
        playheadUs={playheadUs}
        playing={playing}
        onPlayingChange={setPlaying}
        onPlayheadChange={setPlayheadUs}
      />

      <Inspector selectedClipId={selectedClipId} />

      <Timeline
        playheadUs={playheadUs}
        playing={playing}
        onPlayheadChange={setPlayheadUs}
        onPlayingChange={setPlaying}
        selectedClipId={selectedClipId}
        onSelectedClipChange={setSelectedClipId}
        projectVersion={projectVersion}
      />

      {showExport && (
        <ExportDialog onClose={() => setShowExport(false)} />
      )}
    </div>
  );
}
