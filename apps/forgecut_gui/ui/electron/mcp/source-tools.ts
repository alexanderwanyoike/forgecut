import type { McpServer, CallToolResult } from "@modelcontextprotocol/server";
import { commandSchemas } from "../backend/command-schema.js";
import { sourceReadSchema, draftFileSchema } from "./draft-schema.js";

export function registerSourceTools(
  server: McpServer,
  call: (input: unknown) => Promise<CallToolResult>,
) {
  server.registerTool(
    "read_graphic_source",
    {
      description:
        "List bounded source filenames and draft revision, or read one file up to 128 KiB. Choose active or recoverable draft source explicitly. Request includeMetadata when editing a draft schema. Does not execute source.",
      inputSchema: sourceReadSchema,
      annotations: { readOnlyHint: true },
    },
    async (request) => call({ action: "source-read", ...request }),
  );
  server.registerTool(
    "patch_graphic_draft_file",
    {
      description:
        "Save or remove one draft file at its expected draft revision. Preserve other files and manual edits. Source remains inactive until promotion; the normal 1 MiB transport limit applies.",
      inputSchema: draftFileSchema,
    },
    async (request) => call({ action: "draft-file", ...request }),
  );
  server.registerTool(
    "save_graphic_draft",
    {
      description:
        "Replace a bounded component draft, including property/layer schemas and source. Requires its current draft revision and active base version. Use patch_graphic_draft_file for a single source file. Does not change active graphics.",
      inputSchema: commandSchemas.save_graphic_draft,
    },
    async (request) => call({ action: "draft-save", ...request }),
  );
  server.registerTool(
    "revert_graphic_draft",
    {
      description:
        "Replace a draft with the active component at a newer draft revision. This discards the recoverable draft only when its expected revision still matches; project history is unchanged.",
      inputSchema: commandSchemas.revert_graphic_draft,
    },
    async (request) => call({ action: "draft-revert", ...request }),
  );
  server.registerTool(
    "start_graphic_promotion",
    {
      description:
        "Queue compilation and isolated frame checks, then atomically apply source at the expected project and draft revisions. Forks one instance by default. Shared scope affects instances pinned to the same version. Explicit ID mappings or null discards are required for removed/replaced schema IDs. Poll get_job or cancel_job.",
      inputSchema: commandSchemas.start_graphic_promotion,
    },
    async (request) => call({ action: "source-promote", ...request }),
  );
}
