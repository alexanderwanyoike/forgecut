import { usePropertyDraft } from "../hooks/usePropertyDraft";

type Props = {
  className?: string;
  propertyKey?: string;
  value: string;
  onValueChange: (value: string) => void;
};
export default function PropertyTextarea({
  value,
  onValueChange,
  className,
  propertyKey,
}: Props) {
  return (
    <textarea
      className={className}
      data-property-key={propertyKey}
      rows={3}
      {...usePropertyDraft(value, onValueChange)}
    />
  );
}
