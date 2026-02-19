import { createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
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

  return (
    <div class="shell">
      <header class="menu-bar">
        <div class="menu-items">
          <span class="menu-label">File</span>
          <span class="menu-label">Edit</span>
          <span class="menu-label" onClick={() => setShowExport(true)}>Export</span>
        </div>
        <span class="project-name">Untitled Project</span>
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
