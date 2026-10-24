import * as Popover from "@radix-ui/react-popover";
import {
  Clapperboard,
  FileBadge,
  Download,
  FolderOpen,
  Redo2,
  Save,
  Undo2,
} from "lucide-react";
import { useState, useEffect, useRef, lazy, Suspense } from "react";
import CreditsDialog from "./components/CreditsDialog";
import { sequenceDurationUs } from "../electron/domain/sequence";
import ActionButton from "./components/ActionButton";
import AppearanceControls from "./components/AppearanceControls";
import McpStatus from "./components/McpStatus";
import { useSequenceEditor } from "./hooks/useSequenceEditor";
import SequenceControls from "./components/SequenceControls";
import { invoke, open, save } from "./lib/bridge";
import AssetBin from "./components/AssetBin";
import SourceWorkspace from "./components/SourceWorkspace";
import ExportDialog, { type ExportTarget } from "./components/ExportDialog";
import Inspector from "./components/Inspector";
import Preview from "./components/Preview";
import Timeline from "./components/Timeline";
import { useProject } from "./hooks/useProject";

const CodeWorkspace = lazy(() => import("./components/CodeWorkspace"));

export default function App() {
  const [showCredits, setShowCredits] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exportTarget, setExportTarget] = useState<ExportTarget | undefined>();
  const [sourceItemId, setSourceItemId] = useState<string | null>(null);
  const [sourceAssetId, setSourceAssetId] = useState<string | null>(null);
  const sourceClose = useRef<(() => Promise<boolean>) | null>(null);
  const { snapshot, error, setError } = useProject();
  const editor = useSequenceEditor(snapshot);
  const {
    playheadUs,
    setPlayheadUs,
    playing,
    setPlaying,
    selectedClipId,
    selectedLayerId,
    selectClip,
    setSelectedLayerId,
    project,
  } = editor;
  const [recoveryPath, setRecoveryPath] = useState<string | null>(null);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const projectVersion = snapshot?.revision ?? 0;
  const projectName = snapshot?.project.name ?? "Untitled Project";
  useEffect(() => {
    setShowCredits(false);
    setSourceItemId(null);
    setSourceAssetId(null);
    if (snapshot && snapshot.project.timeline.tracks.length === 0) {
      invoke("init_default_tracks").catch(() => {});
    }
  }, [snapshot?.sessionId]);

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
    <div className={sourceItemId ? "shell shell--code" : "shell"}>
      <header className="menu-bar">
        <div className="app-brand">
          <Clapperboard size={21} strokeWidth={1.7} aria-hidden="true" />
          <span>ForgeCut</span>
        </div>
        <div className="menu-items">
          <Popover.Root open={showFileMenu} onOpenChange={setShowFileMenu}>
            <Popover.Trigger asChild>
              <ActionButton icon={FolderOpen} className="quiet-action">
                File
              </ActionButton>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="file-popover"
                align="start"
                sideOffset={8}
                aria-label="Project files"
              >
                <ActionButton
                  icon={FolderOpen}
                  className="quiet-action"
                  onClick={handleOpen}
                >
                  Open Project...
                </ActionButton>
                <ActionButton
                  icon={Save}
                  className="quiet-action"
                  onClick={handleSave}
                >
                  Save Project...
                </ActionButton>
                <ActionButton
                  icon={FileBadge}
                  className="quiet-action"
                  disabled={!snapshot}
                  onClick={() => {
                    setShowFileMenu(false);
                    setPlaying(false);
                    setShowCredits(true);
                  }}
                >
                  Project credits
                </ActionButton>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <div className="history-actions">
            <ActionButton
              icon={Undo2}
              tooltip="Undo project edit (Ctrl+Z)"
              disabled={!snapshot?.canUndo}
              onClick={() => invoke("undo").catch(() => {})}
            >
              Undo
            </ActionButton>
            <ActionButton
              icon={Redo2}
              tooltip="Redo project edit (Ctrl+Y)"
              disabled={!snapshot?.canRedo}
              onClick={() => invoke("redo").catch(() => {})}
            >
              Redo
            </ActionButton>
          </div>
        </div>
        <span className="project-name" title={projectName}>
          {projectName}
        </span>
        <div className="project-actions">
          <AppearanceControls />
          <ActionButton
            icon={Download}
            className="primary-action"
            disabled={!snapshot || !project?.default_sequence}
            onClick={() => {
              if (!snapshot || !project?.default_sequence) return;
              setExportTarget({
                durationUs: sequenceDurationUs(project),
                playheadUs,
                sessionId: snapshot.sessionId,
                sequenceId: project.default_sequence.id,
                name: project.default_sequence.name,
              });
              setShowExport(true);
            }}
          >
            Export
          </ActionButton>
        </div>
      </header>
      <div className="workspace-bar">
        {snapshot && (
          <SequenceControls
            key={snapshot.sessionId}
            snapshot={snapshot}
            selectedItemId={selectedClipId}
            beforeChange={async () => {
              if (sourceClose.current && !(await sourceClose.current()))
                return false;
              setSourceItemId(null);
              return true;
            }}
          />
        )}
        <McpStatus />
      </div>

      {error && (
        <div className="project-notice" role="alert">
          {error}
          {recoveryPath && (
            <ActionButton onClick={handleRecover}>
              Open recovery copy
            </ActionButton>
          )}
          <ActionButton
            onClick={() => {
              setError(null);
              setRecoveryPath(null);
            }}
          >
            Dismiss
          </ActionButton>
        </div>
      )}

      <AssetBin
        projectVersion={projectVersion}
        projectAssets={snapshot?.project.assets}
        resources={snapshot?.project.resources}
        missingMedia={snapshot?.missingMedia}
        onReviewSource={(assetId) => {
          void (async () => {
            if (sourceClose.current && !(await sourceClose.current())) return;
            setPlaying(false);
            setSourceItemId(null);
            setSourceAssetId(assetId);
          })().catch(() => {});
        }}
      />
      {sourceAssetId && snapshot && (
        <SourceWorkspace
          key={`${snapshot.sessionId}:${sourceAssetId}`}
          snapshot={snapshot}
          assetId={sourceAssetId}
          onClose={() => setSourceAssetId(null)}
        />
      )}

      {sourceItemId && snapshot && (
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
      )}

      {!sourceItemId && !sourceAssetId && editor.ready && (
        <Preview
          key={`preview:${editor.key}`}
          sessionId={snapshot?.sessionId}
          selectedClipId={selectedClipId}
          selectedLayerId={selectedLayerId}
          onGraphicSelection={(itemId, layerId) => {
            selectClip(itemId);
            setSelectedLayerId(layerId);
          }}
          project={project ?? undefined}
          playheadUs={playheadUs}
          playing={playing}
          onPlayingChange={setPlaying}
          onPlayheadChange={setPlayheadUs}
          projectVersion={projectVersion}
        />
      )}

      {!sourceItemId && !sourceAssetId && !editor.ready && (
        <section className="panel preview sequence-loading" aria-busy="true">
          {editor.error ? (
            <div role="alert">
              {editor.error}
              <ActionButton onClick={editor.retry}>Retry sequence</ActionButton>
            </div>
          ) : (
            "Loading sequence…"
          )}
        </section>
      )}

      {editor.ready && !sourceAssetId && (
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
            setSourceAssetId(null);
            setSourceItemId(itemId);
          }}
          selectedLayerId={selectedLayerId}
          onSelectedLayerChange={setSelectedLayerId}
          sessionId={snapshot?.sessionId}
          selectedClipId={selectedClipId}
          project={project ?? undefined}
          projectVersion={projectVersion}
        />
      )}

      {editor.ready && (
        <Timeline
          key={`timeline:${editor.key}`}
          playheadUs={playheadUs}
          playing={playing}
          onPlayheadChange={setPlayheadUs}
          onPlayingChange={setPlaying}
          selectedClipId={selectedClipId}
          onSelectedClipChange={selectClip}
          projectVersion={projectVersion}
          projectTimeline={project?.timeline}
          projectStylePresets={project?.style_presets}
          projectSessionId={snapshot?.sessionId}
          projectMediaVersion={JSON.stringify([
            snapshot?.sessionId,
            snapshot?.project.assets,
          ])}
        />
      )}

      {showCredits && snapshot && (
        <CreditsDialog
          key={snapshot.sessionId}
          snapshot={snapshot}
          onClose={() => setShowCredits(false)}
        />
      )}
      <ExportDialog
        open={showExport}
        target={exportTarget}
        onClose={() => setShowExport(false)}
      />
    </div>
  );
}
