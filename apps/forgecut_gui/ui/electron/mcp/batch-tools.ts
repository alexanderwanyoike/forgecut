import type { McpServer, CallToolResult } from "@modelcontextprotocol/server";
import { commandSchemas } from "../backend/command-schema.js";

export function registerBatchTools(
  server: McpServer,
  call: (input: unknown) => Promise<CallToolResult>,
) {
  server.registerTool(
    "create_export_batch",
    {
      description:
        "Capture the current project revision and up to 32 chosen sequences into a new dedicated directory. Saves graphic code/resources and source media paths, without changing the editor. The directory must not exist. Does not start rendering; call resume_export_batch with the returned batch ID. If a response is uncertain, read_export_batch at the same path before creating again.",
      inputSchema: commandSchemas.create_export_batch,
    },
    async (request) => call({ action: "create-batch", ...request }),
  );
  server.registerTool(
    "read_export_batch",
    {
      description:
        "Read bounded export batch metadata and progress from its directory. Works after changing projects or restarting. A running entry without a live owner is interrupted. Does not return or execute captured graphic source.",
      inputSchema: commandSchemas.get_export_batch,
      annotations: { readOnlyHint: true },
    },
    async (request) => call({ action: "read-batch", ...request }),
  );
  server.registerTool(
    "resume_export_batch",
    {
      description:
        "Resume a batch from its saved project snapshot and skip completed outputs. Only one editor may own it. Set retryInterrupted=true explicitly to rerender interrupted, cancelled or failed entries from their beginning; existing outputs for those entries may be replaced. Changes in the current editor do not affect the captured batch. Poll read_export_batch.",
      inputSchema: commandSchemas.resume_export_batch,
    },
    async (request) => call({ action: "resume-batch", ...request }),
  );
  server.registerTool(
    "cancel_export_batch",
    {
      description:
        "Pause a batch and cancel its current render where possible. Atomic output publication finishes if already committing. Remaining entries stay saved for an explicit resume. Identify the batch by both its directory and ID.",
      inputSchema: commandSchemas.cancel_export_batch,
    },
    async (request) => call({ action: "cancel-batch", ...request }),
  );
}
