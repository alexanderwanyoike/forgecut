import { lazy, Suspense, useEffect, useState } from "react";
import type { ProjectSnapshot } from "../../electron/shared/ipc-contract";
import type { GraphicDiagnostic } from "../../electron/shared/graphic-source";
import type {
  GraphicComponent,
  RemotionGraphicItem,
} from "../../electron/shared/graphics";
import { graphicComponentContent } from "../../electron/domain/graphic-component";
import { resolveGraphicInstance } from "../../electron/domain/graphic-instance";
import { frameAtOrAfter } from "../../electron/domain/sequence";
import { useGraphicSourceDraft } from "../hooks/useGraphicSourceDraft";
import { useGraphicCodeActions } from "../hooks/useGraphicCodeActions";
import CodeFileControls from "./CodeFileControls";
import "./code-workspace.css";

const MonacoSourceEditor = lazy(() => import("./MonacoSourceEditor"));
type Props = {
  snapshot: ProjectSnapshot;
  itemId: string;
  onClose: () => void;
  onRegisterClose?: (guard: (() => Promise<boolean>) | null) => void;
};
export default function CodeWorkspace(props: Props) {
  const found = resolveGraphicInstance(props.snapshot.project, props.itemId);
  if (!found.ok)
    return (
      <section className="panel code-workspace">
        <p role="alert">{found.error.message}</p>
        <button onClick={props.onClose}>Canvas</button>
      </section>
    );
  return (
    <Workspace
      {...props}
      component={found.value.component}
      item={found.value.item}
    />
  );
}
function Workspace({
  snapshot,
  itemId,
  onClose,
  onRegisterClose,
  component,
  item,
}: Props & { component: GraphicComponent; item: RemotionGraphicItem }) {
  const source = useGraphicSourceDraft(snapshot.sessionId, itemId, component);
  const [path, setPath] = useState(component.source.entry);
  const [liveDiagnostics, setLiveDiagnostics] = useState<GraphicDiagnostic[]>(
    [],
  );
  const [location, setLocation] = useState<GraphicDiagnostic | undefined>();
  const duration = Math.max(
    1,
    frameAtOrAfter(
      item.timeline_start_us + item.duration_us,
      snapshot.project.settings.fps,
    ) - frameAtOrAfter(item.timeline_start_us, snapshot.project.settings.fps),
  );
  const {
    promotion,
    frame,
    setFrame,
    image,
    scope,
    setScope,
    migrations,
    setMigrations,
    checking,
    message,
    nativeDiagnostics,
    preview,
    apply,
    failure,
    activity,
  } = useGraphicCodeActions(source, snapshot, itemId, duration);
  const diagnostics = [...liveDiagnostics, ...nativeDiagnostics].filter(
    (diagnostic, index, all) =>
      all.findIndex(
        (value) =>
          value.file === diagnostic.file &&
          value.line === diagnostic.line &&
          value.column === diagnostic.column &&
          value.message === diagnostic.message,
      ) === index,
  );
  const affected = snapshot.project.timeline.tracks
    .flatMap((track) => track.items)
    .filter(
      (value) =>
        "RemotionGraphic" in value &&
        value.RemotionGraphic.component_id === component.id &&
        value.RemotionGraphic.component_version === component.version,
    ).length;
  const changed = source.draft
    ? graphicComponentContent(source.draft.component) !==
      graphicComponentContent(component)
    : false;
  async function close(): Promise<boolean> {
    if (source.draft && source.dirty) {
      const saved = await source.flush();
      if (!saved.ok) return false;
    }
    return true;
  }
  useEffect(() => {
    onRegisterClose?.(close);
    return () => onRegisterClose?.(null);
  });
  const sourceFiles = source.draft?.component.source;
  const selected =
    sourceFiles &&
    (Object.prototype.hasOwnProperty.call(sourceFiles.files, path) ||
      path === "@contract")
      ? path
      : (sourceFiles?.entry ?? path);
  return (
    <section
      className="panel code-workspace"
      aria-label="Graphic code workspace"
    >
      <header className="code-header">
        <div>
          <span className="code-eyebrow">COMPONENT CODE</span>
          <strong>{component.name}</strong>
        </div>
        <button
          onClick={async () => {
            if (await close()) onClose();
          }}
        >
          Canvas
        </button>
      </header>
      <div className="code-toolbar">
        <button
          disabled={
            !source.draft || checking || promotion.busy || source.conflict
          }
          onClick={async () => {
            await source.flush();
          }}
        >
          Save draft
        </button>
        <button
          disabled={
            !source.draft || checking || promotion.busy || source.conflict
          }
          onClick={preview}
        >
          Preview draft
        </button>
        <button
          className="code-apply"
          disabled={
            !source.draft ||
            !changed ||
            checking ||
            promotion.busy ||
            source.conflict
          }
          onClick={apply}
        >
          Apply source
        </button>
        <button
          disabled={!source.draft || checking || promotion.busy}
          onClick={async () => {
            await source.revert();
          }}
        >
          Revert draft
        </button>
        <label>
          Apply to{" "}
          <select
            aria-label="Source apply scope"
            value={scope}
            onChange={(event) =>
              setScope(event.currentTarget.value as "instance" | "shared")
            }
          >
            <option value="instance">This instance</option>
            <option value="shared">
              Shared version ({affected} instances)
            </option>
          </select>
        </label>
        {promotion.busy && (
          <button
            disabled={promotion.job?.status === "committing"}
            onClick={() => {
              void promotion.cancel().catch(failure);
            }}
          >
            Cancel Apply
          </button>
        )}
      </div>
      {source.error && (
        <div className="code-notice" role="alert">
          {source.error}
        </div>
      )}
      {source.conflict && (
        <div className="code-conflict">
          <button
            onClick={() => {
              void source.keepEdits();
            }}
          >
            Keep edited files
          </button>
          <button
            onClick={() => {
              void source.reload();
            }}
          >
            Use saved draft
          </button>
        </div>
      )}
      {message.error && (
        <div className="code-notice" role="alert">
          {message.error}
        </div>
      )}
      {sourceFiles && (
        <CodeFileControls
          source={sourceFiles}
          path={selected}
          onPathChange={setPath}
          onChange={source.replaceSource}
        />
      )}
      <div className="code-body">
        <div className="code-editor-host">
          {source.draft ? (
            <Suspense fallback={<p>Loading code editor…</p>}>
              <MonacoSourceEditor
                files={source.draft.component.source.files}
                properties={source.draft.component.properties}
                path={selected}
                onChange={source.change}
                onPathChange={setPath}
                diagnostics={nativeDiagnostics}
                location={location}
                onDiagnostics={setLiveDiagnostics}
                onError={failure}
              />
            </Suspense>
          ) : (
            <p>Loading source…</p>
          )}
        </div>
        <aside className="code-preview">
          <span className="code-eyebrow">DRAFT PREVIEW</span>
          {image ? (
            <img src={image} alt="Draft preview" />
          ) : (
            <p>Preview the draft before applying it.</p>
          )}
          <label>
            Graphic frame {frame}
            <input
              aria-label="Draft frame"
              type="range"
              min={0}
              max={duration - 1}
              value={Math.min(frame, duration - 1)}
              onChange={(event) => setFrame(Number(event.currentTarget.value))}
            />
          </label>
          <p>Instance values and visual positioning stay in Properties.</p>
        </aside>
      </div>
      {diagnostics.length > 0 && (
        <ul className="code-diagnostics" aria-label="Source diagnostics">
          {diagnostics.map((diagnostic, index) => (
            <li
              key={`${diagnostic.file}:${diagnostic.line}:${diagnostic.column}:${index}`}
            >
              <button
                onClick={() => {
                  setPath(diagnostic.file);
                  setLocation({ ...diagnostic });
                }}
              >
                {diagnostic.file}:{diagnostic.line}:{diagnostic.column}{" "}
                {diagnostic.message}
              </button>
            </li>
          ))}
        </ul>
      )}
      <details className="code-migrations">
        <summary>Schema migrations</summary>
        <p>
          Map removed property or layer IDs to new IDs, or null to discard them.
        </p>
        <textarea
          aria-label="Source migration mappings"
          value={migrations}
          onChange={(event) => setMigrations(event.currentTarget.value)}
          spellCheck={false}
        />
      </details>
      <footer className="code-footer">
        <span role="status">
          {source.status}
          {activity ? ` · ${activity}` : ""}
        </span>
        <span>
          Draft undo stays in the editor. Apply creates one project edit.
        </span>
      </footer>
    </section>
  );
}
