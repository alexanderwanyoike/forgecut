import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectSnapshot } from "../../electron/shared/ipc-contract";
import type { GraphicDiagnostic } from "../../electron/shared/graphic-source";
import type { useGraphicSourceDraft } from "./useGraphicSourceDraft";
import { useSourcePromotionJob } from "./useSourcePromotionJob";
import { parseSourceMigrations } from "../lib/source-migrations";
import { invoke } from "../lib/bridge";

export function useGraphicCodeActions(
  source: ReturnType<typeof useGraphicSourceDraft>,
  snapshot: ProjectSnapshot,
  itemId: string,
  duration: number,
) {
  const promotion = useSourcePromotionJob();
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
  const message = notice.version === version ? notice : { text: "", error: "" };
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
          error: result.value.warning ?? "",
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
  return {
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
  };
}
