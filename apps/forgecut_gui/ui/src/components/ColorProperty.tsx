import PropertyInput from "./PropertyInput";

type Props = {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
};
export default function ColorProperty({ label, value, onValueChange }: Props) {
  return (
    <div className="inspector-row">
      <label className="inspector-label">
        {label}
        <input
          aria-label={label}
          type="color"
          className="inspector-color"
          value={value.slice(0, 7)}
          onChange={(event) =>
            onValueChange(event.currentTarget.value + value.slice(7))
          }
        />
      </label>
      <PropertyInput
        aria-label={`${label} hex`}
        className="inspector-input"
        value={value}
        onValueChange={onValueChange}
      />
    </div>
  );
}
