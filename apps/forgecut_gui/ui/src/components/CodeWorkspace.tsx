import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
import { useSourcePromotionJob } from "../hooks/useSourcePromotionJob";
import { parseSourceMigrations } from "../lib/source-migrations";
import { invoke } from "../lib/bridge";
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
  const promotion = useSourcePromotionJob();
  const [path, setPath] = useState(component.source.entry);
  const [frame, setFrame] = useState(0);
  const [image, setImage] = useState("");
  const [scope, setScope] = useState<"instance" | "shared">("instance");
  const [migrations, setMigrations] = useState("{}");
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState({ version: -1, text: "", error: "" });
  const [checked, setChecked] = useState<{
    version: number;
    items: GraphicDiagnostic[];
  }>({ version: -1, items: [] });
  const [liveDiagnostics, setLiveDiagnostics] = useState<GraphicDiagnostic[]>(
    [],
  );
  const [location, setLocation] = useState<GraphicDiagnostic | undefined>();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const version = source.version();
  const nativeDiagnostics = useMemo(
    () => (checked.version === version ? checked.items : []),
    [checked, version],
  );
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
  const duration = Math.max(
    1,
    frameAtOrAfter(
      item.timeline_start_us + item.duration_us,
      snapshot.project.settings.fps,
    ) - frameAtOrAfter(item.timeline_start_us, snapshot.project.settings.fps),
  );
  const affected = snapshot.project.timeline.tracks
    .flatMap((track) => track.items)
    .filter(
      (value) =>
        "RemotionGraphic" in value &&
        value.RemotionGraphic.component_id === component.id &&
        value.RemotionGraphic.component_version === component.version,
    ).length;
  const message = notice.version === version ? notice : { text: "", error: "" };
  const changed = source.draft
    ? graphicComponentContent(source.draft.component) !==
      graphicComponentContent(component)
    : false;
  async function close(): Promise<boolean> {
    if (source.draft) {
      const saved = await source.flush();
      if (!saved.ok) return false;
    }
    return true;
  }
  useEffect(() => {
    onRegisterClose?.(close);
    return () => onRegisterClose?.(null);
  });
  const failure = (error: unknown) => {
    if (alive.current)
      setNotice({
        version: source.version(),
        text: "",
        error: error instanceof Error ? error.message : String(error),
      });
  };
  async function inspect() {
    const saved = await source.flush();
    if (!saved.ok) return saved;
    const token = source.version();
    const result = await invoke("check_graphic_source", {
      source: saved.value.component.source,
      properties: saved.value.component.properties,
    });
    if (!result.ok) {
      if (alive.current)
        setChecked({ version: token, items: result.error.diagnostics });
      return { ok: false as const, error: result.error };
    }
    if (alive.current) setChecked({ version: token, items: [] });
    return saved;
  }
  async function preview(): Promise<void> {
    setChecking(true);
    try {
      const saved = await inspect();
      if (!saved.ok) return;
      const token = source.version();
      const mapping = parseSourceMigrations(migrations);
      if (!mapping.ok) {
        failure(mapping.error.message);
        return;
      }
      const result = await invoke("get_graphic_draft_preview", {
        itemId,
        sessionId: snapshot.sessionId,
        expectedRevision: snapshot.revision,
        expectedDraftRevision: saved.value.revision,
        frame: Math.min(frame, duration - 1),
        mappings: mapping.value,
      });
      if (alive.current && source.version() === token) {
        setImage(`data:${result.mimeType};base64,${result.data}`);
        setNotice({ version: token, text: "Draft preview ready", error: "" });
      }
    } catch (error) {
      failure(error);
    } finally {
      if (alive.current) setChecking(false);
    }
  }
  async function apply(): Promise<void> {
    setChecking(true);
    try {
      const saved = await inspect();
      if (!saved.ok) return;
      const mapping = parseSourceMigrations(migrations);
      if (!mapping.ok) {
        failure(mapping.error.message);
        return;
      }
      const result = await promotion.start({
        itemId,
        sessionId: snapshot.sessionId,
        expectedRevision: snapshot.revision,
        expectedDraftRevision: saved.value.revision,
        requestId: crypto.randomUUID(),
        scope,
        mappings: mapping.value,
      });
      if (!result.ok) {
        failure(result.error.message);
        return;
      }
      await source.refreshIfClean();
      if (alive.current)
        setNotice({
          version: source.version(),
          text: "Source applied",
          error: "",
        });
    } catch (error) {
      failure(error);
    } finally {
      if (alive.current) setChecking(false);
    }
  }
  let activity = message.text;
  if (promotion.busy)
    activity = `Applying ${Math.round((promotion.job?.progress ?? 0) * 100)}%`;
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
          disabled={
            !source.draft || checking || promotion.busy || source.conflict
          }
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
