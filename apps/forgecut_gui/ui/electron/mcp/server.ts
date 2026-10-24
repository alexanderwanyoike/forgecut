import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  resourceRequestSchema,
  exportRequestSchema,
  importRequestSchema,
  jobRequestSchema,
  frameRequestSchema,
  frameJobSchema,
} from "./job-schema.js";
import { editingCapabilities } from "./capabilities.js";
import {
  editRequestSchema,
  historyRequestSchema,
} from "../backend/command-schema.js";
import { idSchema, timeSchema } from "../backend/project-schema.js";
import {
  resourcePageFields,
  pageFields,
  projectFileRequestSchema,
} from "./dispatch.js";
import { callBridge, listSessions, sessionDirectory } from "./sessions.js";
import type { BridgeResult, LocalSession } from "./contract.js";

function toolResult(result: BridgeResult) {
  const frame = result.ok ? frameJobSchema.safeParse(result.value) : undefined;
  if (frame?.success) {
    const { mimeType, data } = frame.data.result.value;
    const metadata = {
      ok: true,
      value: {
        ...frame.data,
        result: {
          ok: true,
          value: { mimeType, bytes: Buffer.byteLength(data, "base64") },
        },
      },
    };
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(metadata) },
        { type: "image" as const, mimeType, data },
      ],
      structuredContent: metadata,
      isError: false,
    };
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result,
    isError: !result.ok,
  };
}

export function createMcpServer(directory = sessionDirectory()): McpServer {
  const server = new McpServer(
    { name: "forgecut", version: "1.0.0" },
    {
      instructions:
        "List sessions and attach to an explicitly selected instance before reading or editing. Read project identity and revision, then use stable item IDs and integer microseconds. Call get_capabilities for supported edit arguments. Apply labelled batches with the expected revision and a unique request ID. On CONFLICT reread and reconsider; retry uncertain results with the identical request ID and input. Never infer an editing target from another instance or an old selection.",
    },
  );
  server.registerTool(
    "get_capabilities",
    {
      description:
        "Read supported edit argument schemas, time units and bounded request limits. Requires no project attachment.",
      inputSchema: z.strictObject({}),
      annotations: { readOnlyHint: true },
    },
    () => toolResult({ ok: true, value: editingCapabilities }),
  );
  let selected: LocalSession | undefined;
  const call = async (input: unknown) =>
    toolResult(
      selected
        ? await callBridge(selected, input)
        : {
            ok: false,
            error: {
              code: "NOT_ATTACHED",
              message:
                "Call list_sessions and explicitly attach_session before accessing a project.",
            },
          },
    );
  server.registerTool(
    "list_sessions",
    {
      description:
        "List running ForgeCut instances. Does not attach to any instance.",
      inputSchema: z.strictObject({}),
    },
    async () =>
      toolResult({
        ok: true,
        value: (await listSessions(directory)).map(({ id, pid }) => ({
          instanceId: id,
          pid,
        })),
      }),
  );
  server.registerTool(
    "attach_session",
    {
      description:
        "Explicitly select a ForgeCut instance and read its project summary. No project is copied into the MCP process.",
      inputSchema: z.strictObject({ instanceId: z.uuid() }),
    },
    async ({ instanceId }) => {
      selected = undefined;
      selected = (await listSessions(directory)).find(
        (session) => session.id === instanceId,
      );
      return call({ action: "summary" });
    },
  );
  server.registerTool(
    "read_project",
    {
      description:
        "Read the selected instance's current project identity, revision, settings and bounded track summary. Read again after a conflict or project switch.",
      inputSchema: z.strictObject({}),
    },
    async () => call({ action: "summary" }),
  );
  server.registerTool(
    "read_assets",
    {
      description:
        "Read a bounded page of assets in an explicitly identified project session.",
      inputSchema: z.strictObject(pageFields),
    },
    async (args) => call({ action: "assets", ...args }),
  );
  server.registerTool(
    "read_timeline",
    {
      description:
        "Read a page of items intersecting [startUs, endUs), using integer microseconds.",
      inputSchema: z.strictObject({
        ...pageFields,
        startUs: timeSchema,
        endUs: timeSchema,
      }),
    },
    async (args) => call({ action: "timeline", ...args }),
  );
  server.registerTool(
    "read_sequence_frame",
    {
      description:
        "Read the current frame, duration and a bounded page of active layers using the same resolver as preview. Times are integer microseconds.",
      inputSchema: z.strictObject({ ...pageFields, playheadUs: timeSchema }),
      annotations: { readOnlyHint: true },
    },
    async (request) => call({ action: "sequence", ...request }),
  );
  server.registerTool(
    "read_item",
    {
      description:
        "Read a timeline item by its stable ID in the selected project session.",
      inputSchema: z.strictObject({ sessionId: idSchema, itemId: idSchema }),
    },
    async (args) => call({ action: "item", ...args }),
  );
  server.registerTool(
    "start_resource_import",
    {
      description:
        "Queue a bounded font/artwork import with licence metadata and optional graphic-property selection. Uses the supplied session/revision for the entire job; retry the same requestId to recover the same job.",
      inputSchema: resourceRequestSchema,
    },
    async (request) => call({ action: "resource", ...request }),
  );
  server.registerTool(
    "read_graphic_resources",
    {
      description:
        "Read up to 20 project font/artwork metadata records. Full licence text is available through read_graphic_resource.",
      inputSchema: z.strictObject(resourcePageFields),
      annotations: { readOnlyHint: true },
    },
    async (request) => call({ action: "resources", ...request }),
  );
  server.registerTool(
    "read_graphic_resource",
    {
      description:
        "Read one project's font/artwork metadata and full retained licence text, without binary bytes.",
      inputSchema: z.strictObject({
        sessionId: idSchema,
        resourceId: idSchema,
      }),
      annotations: { readOnlyHint: true },
    },
    async (request) => call({ action: "resource-details", ...request }),
  );
  server.registerTool(
    "list_graphic_templates",
    {
      description:
        "Read available packaged graphic templates, editable property schemas, defaults and stable layer IDs. Component source is separate from instance values.",
      inputSchema: z.strictObject({ sessionId: idSchema }),
      annotations: { readOnlyHint: true },
    },
    async (request) => call({ action: "templates", ...request }),
  );
  server.registerTool(
    "read_graphic_component",
    {
      description:
        "Read the property schema, dependencies and stable layer IDs of an exact component version in the current project. Use the instance's explicit component ID and version.",
      inputSchema: z.strictObject({
        sessionId: idSchema,
        componentId: idSchema,
        version: z.string().regex(/^[a-f0-9]{64}$/),
      }),
      annotations: { readOnlyHint: true },
    },
    async (request) => call({ action: "component", ...request }),
  );
  server.registerTool(
    "apply_edits",
    {
      description:
        "Atomically apply a labelled edit batch at the expected revision. A successful batch is one undo action. On CONFLICT reread; retry uncertain results with the same request ID and identical input.",
      inputSchema: editRequestSchema.extend({
        label: z.string().min(1).max(120),
      }),
    },
    async ({ label, ...request }) => call({ action: "apply", label, request }),
  );
  server.registerTool(
    "apply_history",
    {
      description:
        "Undo or redo one complete project edit with session, revision and retry guards. Reusing a request ID with different input is rejected.",
      inputSchema: historyRequestSchema,
    },
    async (request) => call({ action: "history", request }),
  );
  server.registerTool(
    "save_project",
    {
      description:
        "Save a snapshot of the selected project atomically to an absolute path. Returns the saved revision, which may precede later manual edits.",
      inputSchema: projectFileRequestSchema,
    },
    async (request) => call({ action: "save", ...request }),
  );
  server.registerTool(
    "open_project",
    {
      description:
        "Replace the selected instance's project with a validated project file. Requires the current identity/revision; rejects concurrent edits and preserves the open project on failure. Returns a new project session identity.",
      inputSchema: projectFileRequestSchema,
    },
    async (request) => call({ action: "open", ...request }),
  );
  server.registerTool(
    "read_context",
    {
      description:
        "Read stable selected item IDs, playhead and an independent context revision for an explicitly identified project session. Target IDs explicitly in later edits; selection changes do not change the project revision.",
      inputSchema: z.strictObject({ sessionId: idSchema }),
      annotations: { readOnlyHint: true },
    },
    async (request) => call({ action: "context", ...request }),
  );
  server.registerTool(
    "start_import",
    {
      description:
        "Queue a media import at an explicit project revision. Returns a job immediately. Retry with identical input and request ID; poll get_job for completion and created asset IDs. A successful import is one undo action.",
      inputSchema: importRequestSchema,
    },
    async (request) => call({ action: "import", ...request }),
  );
  server.registerTool(
    "get_job",
    {
      description:
        "Read a retained media job by job ID and its original project session. Progress, status and typed results are bounded; terminal jobs may be evicted.",
      inputSchema: jobRequestSchema,
      annotations: { readOnlyHint: true },
    },
    async (request) => call({ action: "job", ...request }),
  );
  server.registerTool(
    "cancel_job",
    {
      description:
        "Cancel a queued or running media job in its original project session. Poll until cancellation completes; a running process keeps its queue slot until it exits.",
      inputSchema: jobRequestSchema,
    },
    async (request) => call({ action: "cancel", ...request }),
  );
  server.registerTool(
    "start_source_frame",
    {
      description:
        "Queue a bounded source JPEG at integer microseconds from an imported visual asset. Returns a job immediately. get_job returns native image content when complete. Maximum dimensions 640 by 360; maximum JPEG size 512 KiB.",
      inputSchema: frameRequestSchema,
    },
    async (request) => call({ action: "frame", ...request }),
  );
  server.registerTool(
    "start_export",
    {
      description:
        "Queue an MP4 export of the explicitly identified project revision. The immutable snapshot remains unchanged while editing continues. Poll get_job; cancel_job stops rendering before publication. A committing job is finishing its atomic output replacement and can no longer be cancelled.",
      inputSchema: exportRequestSchema,
    },
    async (request) => call({ action: "export", ...request }),
  );
  return server;
}
