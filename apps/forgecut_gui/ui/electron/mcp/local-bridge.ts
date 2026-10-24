import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { dispatchLocal, bridgeRequestSchema } from "./dispatch.js";
import type { EditingService } from "../backend/editing-service.js";
import {
  MAX_MESSAGE_BYTES,
  type BridgeResult,
  type LocalSession,
} from "./contract.js";
import { sessionDirectory } from "./sessions.js";

export async function startLocalBridge(
  service: EditingService,
  directory = sessionDirectory(),
  onActivity?: (label: string) => void,
) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || (process.getuid && info.uid !== process.getuid()))
    throw new Error("MCP directory must be owned by the current user");
  await chmod(directory, 0o700);
  const runtime = await mkdtemp(join(tmpdir(), "forgecut-"));
  await chmod(runtime, 0o700);
  const session: LocalSession = {
    id: randomUUID(),
    pid: process.pid,
    socket: "",
    secret: randomBytes(32).toString("hex"),
  };
  session.socket =
    process.platform === "win32"
      ? `\\\\.\\pipe\\forgecut-${session.id}`
      : join(runtime, "editor.sock");
  const send = (res: ServerResponse, result: BridgeResult) => {
    const encoded = JSON.stringify(result);
    res.setHeader("content-type", "application/json");
    res.end(
      Buffer.byteLength(encoded) <= MAX_MESSAGE_BYTES
        ? encoded
        : JSON.stringify({
            ok: false,
            error: {
              code: "TOO_LARGE",
              message: "Result exceeds the 1 MiB limit. Read a smaller page.",
            },
          }),
    );
  };
  const serve = async (req: IncomingMessage, res: ServerResponse) => {
    const actual = Buffer.from(req.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${session.secret}`);
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      res.statusCode = 401;
      send(res, {
        ok: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid local session credentials.",
        },
      });
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(String(chunk));
      bytes += buffer.length;
      if (bytes > MAX_MESSAGE_BYTES) {
        res.statusCode = 413;
        send(res, {
          ok: false,
          error: {
            code: "INVALID_INPUT",
            message: "Request exceeds the 1 MiB limit.",
          },
        });
        req.destroy();
        return;
      }
      chunks.push(buffer);
    }
    const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (req.method !== "POST" || req.url !== "/tools") {
      send(res, {
        ok: false,
        error: { code: "INVALID_INPUT", message: "Unknown local operation." },
      });
      return;
    }
    const result = await dispatchLocal(service, input);
    if (result.ok && onActivity) {
      const request = bridgeRequestSchema.parse(input);
      const labels = {
        export: "Export project",
        import: "Import media",
        frame: "Source frame",
        job: "Read job",
        cancel: "Cancel job",
        summary: "Read project",
        assets: "Read assets",
        timeline: "Read timeline",
        sequence: "Read sequence frame",
        item: "Read item",
        apply: "Apply edits",
        history: "Change history",
        save: "Save project",
        open: "Open project",
        context: "Read editing context",
        templates: "Read graphic templates",
        component: "Read graphic component",
      };
      let label = labels[request.action];
      if (request.action === "apply") label = request.label;
      if (request.action === "history")
        label = request.request.direction === "undo" ? "Undo" : "Redo";
      try {
        onActivity(label);
      } catch (error) {
        console.warn("MCP activity listener failed", error);
      }
    }
    send(res, result);
  };
  const server = createServer((req, res) => {
    void serve(req, res).catch(() =>
      send(res, {
        ok: false,
        error: { code: "INVALID_INPUT", message: "Invalid local request." },
      }),
    );
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.listen(session.socket);
  await once(server, "listening");
  const descriptor = join(directory, `${session.id}.json`);
  await writeFile(descriptor, JSON.stringify(session), {
    mode: 0o600,
    flag: "wx",
  });
  return {
    session,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await rm(descriptor, { force: true });
      await rm(runtime, { recursive: true, force: true });
    },
  };
}
