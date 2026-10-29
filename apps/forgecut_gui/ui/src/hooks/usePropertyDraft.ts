import { useState } from "react";

export function usePropertyDraft(
  value: string | number,
  onValueChange: (value: string) => void,
) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  return {
    value: focused ? draft : value,
    onFocus: () => {
      setDraft(String(value));
      setFocused(true);
    },
    onBlur: () => setFocused(false),
    onChange: (event: { currentTarget: { value: string } }) => {
      setDraft(event.currentTarget.value);
      onValueChange(event.currentTarget.value);
    },
  };
}
