import { useState } from "react";
import type { ProjectSnapshot } from "../../electron/shared/ipc-contract";
import { invoke, open } from "../lib/bridge";
import type { GraphicResource } from "../../electron/shared/graphic-resources";

type Props = {
  origin?: Pick<ProjectSnapshot, "sessionId" | "revision">;
  kind?: "Font" | "Image";
  itemId: string;
  property: string;
  label: string;
  value: string;
  resources: GraphicResource[];
  onValueChange: (value: string) => void;
};
export default function ResourceProperty({
  origin,
  kind = "Font",
  itemId,
  property,
  label,
  value,
  resources,
  onValueChange,
}: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const actionLabel = kind === "Font" ? "Import font" : "Import artwork";
  const importResource = async () => {
    const captured = origin;
    if (!captured) {
      setError("The project is not ready for resource import.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const path = await open<string | null>({
        multiple: false,
        title: kind === "Font" ? "Choose a font" : "Choose artwork",
        filters: [
          kind === "Font"
            ? { name: "Fonts", extensions: ["ttf", "otf", "woff", "woff2"] }
            : { name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] },
        ],
      });
      if (!path) return;
      const licensePath =
        kind === "Font"
          ? await open<string | null>({
              multiple: false,
              title: "Choose this font's licence text",
              filters: [{ name: "Licence text", extensions: ["*"] }],
            })
          : null;
      if (kind === "Font" && !licensePath) return;
      await invoke("import_graphic_resource", {
        path,
        kind,
        ...(licensePath
          ? { licensePath }
          : {
              license: {
                identifier: "Unspecified",
                text: "Licence information was not supplied at import.",
              },
            }),
        target: {
          itemId,
          property,
          sessionId: captured.sessionId,
          expectedRevision: captured.revision,
        },
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <label className="inspector-row">
        <span className="inspector-label">{label}</span>
        <select
          className="inspector-input"
          value={value}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          disabled={pending}
        >
          <option value="">
            {kind === "Font" ? "System sans-serif" : "None"}
          </option>
          {resources
            .filter((resource) => resource.kind === kind)
            .map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.name}
              </option>
            ))}
        </select>
      </label>
      <button
        className="preview-btn"
        aria-label={actionLabel}
        disabled={pending}
        onClick={importResource}
      >
        {pending ? "Importing…" : `${actionLabel}…`}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
