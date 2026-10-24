import type { EditErrorCode } from "../shared/ipc-contract.js";

export class EditingError extends Error {
  constructor(public readonly code: EditErrorCode, message: string) {
    super(message);
  }
}
