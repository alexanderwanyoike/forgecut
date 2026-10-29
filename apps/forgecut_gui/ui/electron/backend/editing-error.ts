import type { GraphicDiagnostic } from "../shared/graphic-source.js";
import type { EditErrorCode } from "../shared/ipc-contract.js";

export class EditingError extends Error {
  constructor(
    public readonly code: EditErrorCode,
    message: string,
    public readonly diagnostics?: GraphicDiagnostic[],
  ) {
    super(message);
  }
}
