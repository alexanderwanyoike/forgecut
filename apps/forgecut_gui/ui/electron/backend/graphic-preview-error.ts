import type { EditErrorCode } from "../shared/ipc-contract.js";
import { EditingError } from "./editing-error.js";

export function graphicPreviewError(error: {
  code: string;
  message: string;
}): EditingError {
  const codes: EditErrorCode[] = [
    "NOT_FOUND",
    "INVALID_INPUT",
    "CANCELLED",
    "PROJECT_CHANGED",
    "UNAVAILABLE",
    "RENDER_FAILED",
    "TIMEOUT",
  ];
  const code =
    codes.find((candidate) => candidate === error.code) ?? "IO_ERROR";
  return new EditingError(code, error.message);
}
