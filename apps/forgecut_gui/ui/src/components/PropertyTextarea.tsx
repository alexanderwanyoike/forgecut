import { useState } from "react";

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
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  return (
    <textarea
      className={className}
      rows={3}
      value={focused ? draft : value}
      onFocus={() => {
        setDraft(value);
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      onChange={(event) => {
        setDraft(event.currentTarget.value);
        onValueChange(event.currentTarget.value);
      }}
    />
  );
}
