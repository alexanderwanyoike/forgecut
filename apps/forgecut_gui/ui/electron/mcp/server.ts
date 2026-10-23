import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { editRequestSchema } from "../backend/command-schema.js";
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
  const server = new McpServer({ name: "forgecut", version: "1.0.0" });
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
  return server;
}
