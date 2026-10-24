import { useState } from "react";
import type { GraphicComponent } from "../../electron/shared/graphics";

type Props = {
  source: GraphicComponent["source"];
  path: string;
  onPathChange: (path: string) => void;
  onChange: (source: GraphicComponent["source"]) => void;
};
export default function CodeFileControls({
  source,
  path,
  onPathChange,
  onChange,
}: Props) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const add = () => {
    const file = name.trim();
    if (
      file.length > 256 ||
      !/^[a-z\d_.-]+(?:\/[a-z\d_.-]+)*$/i.test(file) ||
      file.split("/").some((part) => part === "." || part === "..")
    ) {
      setError("Use a relative filename such as helpers.tsx");
      return;
    }
    if (
      Object.prototype.hasOwnProperty.call(source.files, file) ||
      Object.keys(source.files).length >= 32
    ) {
      setError("Choose a new filename; workspaces allow 32 files");
      return;
    }
    onChange({ ...source, files: { ...source.files, [file]: "" } });
    onPathChange(file);
    setName("");
    setError("");
  };
  return (
    <div className="code-files">
      <select
        aria-label="Source file"
        value={path}
        onChange={(event) => onPathChange(event.currentTarget.value)}
      >
        {Object.keys(source.files).map((file) => (
          <option key={file} value={file}>
            {file}
            {file === source.entry ? " · entry" : ""}
          </option>
        ))}
        <option value="@contract">Property types (read only)</option>
      </select>
      <button
        disabled={
          path === "@contract" ||
          path === source.entry ||
          !/\.(?:[cm]?[jt]s|[jt]sx)$/.test(path) ||
          path.endsWith(".d.ts")
        }
        onClick={() => onChange({ ...source, entry: path })}
      >
        Make entry
      </button>
      <button
        disabled={path === "@contract" || path === source.entry}
        onClick={() => {
          const files = { ...source.files };
          delete files[path];
          onChange({ ...source, files });
          onPathChange(source.entry);
        }}
      >
        Remove file
      </button>
      <input
        aria-label="New source filename"
        value={name}
        placeholder="helpers.tsx"
        onChange={(event) => setName(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") add();
        }}
      />
      <button onClick={add}>Add file</button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
