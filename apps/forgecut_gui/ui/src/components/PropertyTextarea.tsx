import { usePropertyDraft } from "../hooks/usePropertyDraft";

type Props = {
  className?: string;
  value: string;
  onValueChange: (value: string) => void;
};
export default function PropertyTextarea({
  value,
  onValueChange,
  className,
}: Props) {
  return (
    <textarea
      className={className}
      rows={3}
      {...usePropertyDraft(value, onValueChange)}
    />
  );
}
