import type { InputHTMLAttributes } from "react";
import { usePropertyDraft } from "../hooks/usePropertyDraft";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
> & {
  value: string | number;
  onValueChange: (value: string) => void;
};

export default function PropertyInput({
  value,
  onValueChange,
  ...props
}: Props) {
  return <input {...props} {...usePropertyDraft(value, onValueChange)} />;
}
