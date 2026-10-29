import type { ProjectSettings } from "../../electron/shared/ipc-contract";
import ActionButton from "./ActionButton";

export type NameEdit =
  | { kind: "create"; name: string; settings: ProjectSettings }
  | { kind: "rename"; name: string; sequenceId: string }
  | {
      kind: "variant";
      name: string;
      sourceSequenceId: string;
      sourceName: string;
      format: "source" | "portrait" | "landscape";
    };
export const variantSizes = {
  portrait: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
};
const submitLabels = {
  create: "Create sequence",
  rename: "Save sequence name",
  variant: "Create variant",
};

type Props = {
  form: NameEdit;
  busy: boolean;
  onChange: (form: NameEdit) => void;
  onSubmit: () => void;
  onCancel: () => void;
};
export default function SequenceNameForm({
  form,
  busy,
  onChange,
  onSubmit,
  onCancel,
}: Props) {
  return (
    <form
      className="sequence-name-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label>
        Sequence name
        <input
          aria-label="Sequence name"
          maxLength={200}
          autoFocus
          disabled={busy}
          value={form.name}
          onChange={(event) => {
            const name = event.currentTarget.value;
            onChange({ ...form, name });
          }}
        />
      </label>
      {form.kind === "variant" && (
        <>
          <p>Source: {form.sourceName}</p>
          <label>
            Variant format
            <select
              value={form.format}
              disabled={busy}
              onChange={(event) => {
                const format = event.currentTarget.value;
                if (
                  format === "source" ||
                  format === "portrait" ||
                  format === "landscape"
                )
                  if (form.kind === "variant") onChange({ ...form, format });
              }}
            >
              <option value="source">Same dimensions</option>
              <option value="portrait">Portrait / 1080 × 1920</option>
              <option value="landscape">Landscape / 1920 × 1080</option>
            </select>
          </label>
        </>
      )}
      <div className="sequence-form-actions">
        <ActionButton
          type="submit"

          disabled={busy || !form.name.trim()}
        >
          {submitLabels[form.kind]}
        </ActionButton>
        <ActionButton
          type="button"

          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </ActionButton>
      </div>
    </form>
  );
}
