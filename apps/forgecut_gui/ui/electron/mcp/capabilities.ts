import { z } from "zod";
import { editSchemas } from "../backend/command-schema.js";
import { MAX_MESSAGE_BYTES } from "./contract.js";

export const editingCapabilities = {
  schemaVersion: 1,
  timeUnit: "microseconds",
  limits: {
    operationsPerBatch: 100,
    itemsPerPage: 100,
    messageBytes: MAX_MESSAGE_BYTES,
  },
  operations: Object.fromEntries(
    Object.entries(editSchemas).map(([command, schema]) => [
      command,
      z.toJSONSchema(schema),
    ]),
  ),
};
