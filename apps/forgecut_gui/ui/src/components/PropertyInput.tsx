import { useState, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string | number;
  onValueChange: (value: string) => void;
};

export default function PropertyInput({ value, onValueChange, ...props }: Props) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  return <input {...props} value={focused ? draft : value}
    onFocus={() => { setDraft(String(value)); setFocused(true); }}
    onBlur={() => setFocused(false)}
    onChange={(event) => {
      setDraft(event.currentTarget.value);
      onValueChange(event.currentTarget.value);
    }} />;
}
