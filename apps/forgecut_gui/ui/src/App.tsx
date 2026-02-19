import { createSignal, Show, onMount, onCleanup } from "solid-js";
import type { Component } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import AssetBin from "./components/AssetBin";
import ExportDialog from "./components/ExportDialog";
import Inspector from "./components/Inspector";
import Preview from "./components/Preview";
import Timeline from "./components/Timeline";

const App: Component = () => {
  const [showExport, setShowExport] = createSignal(false);
  const [playheadUs, setPlayheadUs] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [selectedClipId, setSelectedClipId] = createSignal<string | null>(null);
  const [projectName, setProjectName] = createSignal("Untitled Project");
  const [showFileMenu, setShowFileMenu] = createSignal(false);

  onMount(() => {
    const interval = setInterval(async () => {
      try { await invoke("autosave"); } catch (_) {}
    }, 60_000);
    onCleanup(() => clearInterval(interval));
  });

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
      // Reload the page state by re-fetching timeline
      window.location.reload();
    } catch (e) {
      console.error("load_project failed:", e);
    }
  };

  return (
    <div class="shell" onClick={() => showFileMenu() && setShowFileMenu(false)}>
      <header class="menu-bar">
        <div class="menu-items">
          <span
            class="menu-label"
            onClick={(e) => { e.stopPropagation(); setShowFileMenu(!showFileMenu()); }}
          >
            File
            <Show when={showFileMenu()}>
              <div class="dropdown-menu" onClick={(e) => e.stopPropagation()}>
                <div class="dropdown-item" onClick={handleOpen}>Open Project...</div>
                <div class="dropdown-item" onClick={handleSave}>Save Project...</div>
              </div>
            </Show>
          </span>
          <span class="menu-label">Edit</span>
          <span class="menu-label" onClick={() => setShowExport(true)}>Export</span>
        </div>
        <span class="project-name">{projectName()}</span>
      </header>

      <AssetBin />

      <Preview
        playheadUs={playheadUs()}
        playing={playing()}
        onPlayingChange={setPlaying}
        onPlayheadChange={setPlayheadUs}
      />

      <Inspector selectedClipId={selectedClipId()} />

      <Timeline
        playheadUs={playheadUs()}
        playing={playing()}
        onPlayheadChange={setPlayheadUs}
        selectedClipId={selectedClipId()}
        onSelectedClipChange={setSelectedClipId}
      />

      <Show when={showExport()}>
        <ExportDialog onClose={() => setShowExport(false)} />
      </Show>
    </div>
  );
};

export default App;
