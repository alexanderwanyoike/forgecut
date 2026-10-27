import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { registerBatchTools } from "./batch-tools.js";
import { stylePropertyPageFields } from "./style-schema.js";
import { registerSourceTools } from "./source-tools.js";
import { sourceCheckRequestSchema } from "./source-schema.js";
import {
  resourceRequestSchema,
  exportRequestSchema,
  importRequestSchema,
  jobRequestSchema,
  frameRequestSchema,
  imageJobSchema,
  sourcePreviewJobSchema,
} from "./job-schema.js";
import { editingCapabilities } from "./capabilities.js";
import {
  sourceReviewRequestSchema,
  editRequestSchema,
  historyRequestSchema,
} from "../backend/command-schema.js";
import { idSchema, timeSchema } from "../backend/project-schema.js";
import { pageFields, resourcePageFields } from "./page-schema.js";
import {
  sequencePageFields,
  sequenceSelectionSchema,
} from "./sequence-schema.js";
import { projectFileRequestSchema } from "./dispatch.js";
import { callBridge, listSessions, sessionDirectory } from "./sessions.js";
import type { BridgeResult, LocalSession } from "./contract.js";

function toolResult(result: BridgeResult) {
  const frame = result.ok ? imageJobSchema.safeParse(result.value) : undefined;
  if (frame?.success) {
    const { mimeType, data, ...imageMetadata } = frame.data.result.value;
    const metadata = {
      ok: true,
      value: {
        ...frame.data,
        result: {
          ok: true,
          value: {
            ...imageMetadata,
            mimeType,
            bytes: Buffer.byteLength(data, "base64"),
          },
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
  const preview = result.ok
    ? sourcePreviewJobSchema.safeParse(result.value)
    : undefined;
  let visible = result;
  if (preview?.success) {
    const { data, ...metadata } = preview.data.result.value;
    visible = {
      ok: true,
      value: {
        ...preview.data,
        result: {
          ok: true,
          value: { ...metadata, bytes: Buffer.byteLength(data, "base64") },
        },
      },
    };
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(visible) }],
    structuredContent: visible,
    isError: !visible.ok,
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
  registerSourceTools(server, call);
  registerBatchTools(server, call);
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
    "read_sequences",
    {
      description:
        "Read a bounded page of sequence IDs, names and settings, with the default and active sequence IDs. Explicitly target sequence IDs in subsequent reads, edits, history and exports.",
      inputSchema: z.strictObject(pageFields),
      annotations: { readOnlyHint: true },
    },
    async (args) => call({ action: "sequences", ...args }),
  );
  server.registerTool(
    "select_sequence",
    {
      description:
        "Switch the visible editor to a sequence without changing creative history. Requires the sequence revision from read_context or read_sequences; rejects a stale context. Explicit sequence reads and edits do not require switching the editor.",
      inputSchema: sequenceSelectionSchema,
    },
    async (args) => call({ action: "select-sequence", ...args }),
  );
  server.registerTool(
    "read_asset_credit",
    {
      description:
        "Read one recording, music or image asset's complete licence/provenance and attribution. Missing metadata returns null. Asset pages omit licence text; use read_graphic_resource for font/artwork resource details. Update with set_asset_license or set_resource_license through guarded apply_edits.",
      inputSchema: z.strictObject({ sessionId: idSchema, assetId: idSchema }),
      annotations: { readOnlyHint: true },
    },
    async (request) => call({ action: "asset-credit", ...request }),
  );
  server.registerTool(
    "read_style_presets",
    {
      description:
        "Read up to 20 project card/ending style identities with names, canvas sizes and exact component versions. Use add_graphic_from_preset in apply_edits to create an independently editable instance with optional property overrides. This bounded metadata page excludes property payloads; use read_style_preset to inspect saved values without editing the timeline.",
      inputSchema: z.strictObject(resourcePageFields),
      annotations: { readOnlyHint: true },
    },
    async (args) => call({ action: "style-presets", ...args }),
  );
  server.registerTool(
    "read_style_preset",
    {
      description:
        "Read a page of at most five saved property values for an exact project style ID without creating a timeline item. Read all pages before replacing a style if preserving existing values. The small page bound keeps maximum-size text properties within the local transport limit.",
      inputSchema: z.strictObject(stylePropertyPageFields),
      annotations: { readOnlyHint: true },
    },
    async (args) => call({ action: "style-preset-values", ...args }),
  );
  server.registerTool(
    "read_source_selections",
    {
      description:
        "Read up to 20 source selections with source-relative in/out microseconds, names, notes and rationale. Optional assetId restricts the page. Read again before changing a selection through save_source_selection in apply_edits so manual notes are retained.",
      inputSchema: z.strictObject({
        ...resourcePageFields,
        assetId: idSchema.optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => call({ action: "source-selections", ...args }),
  );
  server.registerTool(
    "read_timeline",
    {
      description:
        "Read a page of items intersecting [startUs, endUs), using integer microseconds. Provide sequenceId for multi-sequence projects.",
      inputSchema: z.strictObject({
        ...sequencePageFields,
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
        "Read the current frame, duration and a bounded page of active layers using the same resolver as preview. Times are integer microseconds. Provide sequenceId for multi-sequence projects.",
      inputSchema: z.strictObject({
        ...sequencePageFields,
        playheadUs: timeSchema,
      }),
      annotations: { readOnlyHint: true },
    },
    async (request) => call({ action: "sequence", ...request }),
  );
  server.registerTool(
    "read_item",
    {
      description:
        "Read a timeline item by its globally unique stable ID and return its owning sequence. An optional sequenceId restricts the lookup to that sequence.",
      inputSchema: z.strictObject({
        sessionId: idSchema,
        sequenceId: idSchema.optional(),
        itemId: idSchema,
      }),
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
    "start_graphic_source_check",
    {
      description:
        "Check a bounded TSX workspace for syntax, types and approved imports in a cancellable job. Source is not executed and active project source is unchanged. Poll get_job for located diagnostics.",
      inputSchema: sourceCheckRequestSchema,
      annotations: { readOnlyHint: true },
    },
    async (request) => call({ action: "source-check", ...request }),
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
    "start_source_review",
    {
      description:
        "Queue a cached source contact sheet or waveform for a range between 100 milliseconds and 30 seconds. Contact sheets contain 12 uniformly sampled cells and return native image content through get_job. Waveforms have at most 512 min/max bins at 8 kHz. Video previews cover up to 5 seconds with optional audio, are capped at 512 KiB and play in the desktop. MCP returns preview metadata and byte size without video payloads in text. The project is unchanged; jobs use existing retry and cancellation guards.",
      inputSchema: sourceReviewRequestSchema,
      annotations: { readOnlyHint: true },
    },
    async (request) => call({ action: "source-review", request }),
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
        "Queue an export of the explicitly identified project revision and sequence. Optional preset selects mp4 (H.264/AAC, default) or webm (VP9/Opus); use the matching output filename extension. Provide sequenceId for multi-sequence projects. Optional range selects a 0.1 to 30 second review interval aligned to sequence frames; omit it for a full export. The immutable snapshot remains unchanged while editing continues. Poll get_job; cancel_job stops rendering before publication. A committing job is finishing its atomic output replacement and can no longer be cancelled.",
      inputSchema: exportRequestSchema,
    },
    async (request) => call({ action: "export", ...request }),
  );
  return server;
}
