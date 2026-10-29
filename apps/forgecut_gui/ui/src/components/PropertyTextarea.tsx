import { usePropertyDraft } from "../hooks/usePropertyDraft";

type Props = {
  className?: string;
  maxLength?: number;
  propertyKey?: string;
  value: string;
  onValueChange: (value: string) => void;
};
export default function PropertyTextarea({
  value,
  onValueChange,
  className,
  maxLength,
  propertyKey,
}: Props) {
  return (
    <textarea
      className={className}
      data-property-key={propertyKey}
      rows={3}
      maxLength={maxLength}
      {...usePropertyDraft(value, onValueChange)}
    />
  );
}
