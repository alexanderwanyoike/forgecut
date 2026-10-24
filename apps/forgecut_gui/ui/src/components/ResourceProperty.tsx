import { useState } from "react";
import { invoke, open } from "../lib/bridge";
import type { GraphicResource } from "../../electron/shared/graphic-resources";

type Props = {
  itemId: string;
  property: string;
  label: string;
  value: string;
  resources: GraphicResource[];
  onValueChange: (value: string) => void;
};
export default function ResourceProperty({
  itemId,
  property,
  label,
  value,
  resources,
  onValueChange,
}: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const importFont = async () => {
    const path = await open<string | null>({
      multiple: false,
      title: "Choose a font",
      filters: [{ name: "Fonts", extensions: ["ttf", "otf", "woff", "woff2"] }],
    });
    if (!path) return;
    const licensePath = await open<string | null>({
      multiple: false,
      title: "Choose this font's licence text",
      filters: [{ name: "Licence text", extensions: ["*"] }],
    });
    if (!licensePath) return;
    setPending(true);
    setError("");
    try {
      await invoke("import_graphic_resource", {
        path,
        kind: "Font",
        licensePath,
        target: { itemId, property },
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
          <option value="">System sans-serif</option>
          {resources
            .filter((resource) => resource.kind === "Font")
            .map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.name}
              </option>
            ))}
        </select>
      </label>
      <button
        className="preview-btn"
        aria-label="Import font"
        disabled={pending}
        onClick={() => {
          void importFont().catch((failure: unknown) =>
            setError(
              failure instanceof Error ? failure.message : String(failure),
            ),
          );
        }}
      >
        {pending ? "Importing font…" : "Import font…"}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
