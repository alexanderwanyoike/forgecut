import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { editingCapabilities } from "./capabilities.js";
import {
  editRequestSchema,
  historyRequestSchema,
} from "../backend/command-schema.js";
import { idSchema, timeSchema } from "../backend/project-schema.js";
import { pageFields } from "./dispatch.js";
import { callBridge, listSessions, sessionDirectory } from "./sessions.js";
import type { BridgeResult, LocalSession } from "./contract.js";

function toolResult(result: BridgeResult) {
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
    "read_item",
    {
      description:
        "Read a timeline item by its stable ID in the selected project session.",
      inputSchema: z.strictObject({ sessionId: idSchema, itemId: idSchema }),
    },
    async (args) => call({ action: "item", ...args }),
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
  return server;
}
