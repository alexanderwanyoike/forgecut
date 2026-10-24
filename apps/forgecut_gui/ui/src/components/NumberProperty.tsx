import PropertyInput from "./PropertyInput";

type Props = {
  label: string;
  value: number;
  min?: number;
  onValueChange: (value: number) => void | Promise<void>;
};
export default function NumberProperty({
  label,
  value,
  min,
  onValueChange,
}: Props) {
  return (
    <label className="inspector-row">
      <span className="inspector-label">{label}</span>
      <PropertyInput
        type="number"
        className="inspector-input-sm"
        value={value}
        min={min}
        onValueChange={(raw) => {
          if (raw === "") return;
          const next = Number(raw);
          if (Number.isFinite(next) && (min === undefined || next >= min))
            void onValueChange(next);
        }}
      />
    </label>
  );
}
