import { verifyCredits } from "./credits-smoke.mjs";
import { verifyStyleControls } from "./style-controls-smoke.mjs";
import { verifyStylePresets } from "./style-preset-smoke.mjs";
import { verifySourceSelections } from "./source-selection-smoke.mjs";
import { verifyVariants } from "./variant-smoke.mjs";
import { verifyAppearance } from "./appearance-smoke.mjs";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyGraphicsPreview } from "./graphics-preview-smoke.mjs";
import { verifyCode } from "./code-smoke.mjs";
import { verifySequences } from "./sequence-smoke.mjs";
import { verifyCanvas } from "./canvas-smoke.mjs";
import { verifyAudio } from "./audio-smoke.mjs";
import { verifyMcp } from "./mcp-smoke.mjs";
import { spawn } from "node:child_process";

const remoteDebuggingPort = String(19_222 + Math.floor(Math.random() * 1000));
const remoteDebuggingUrl = `http://127.0.0.1:${remoteDebuggingPort}`;
const expectedText = ["ASSETS", "INSPECTOR", "TIMELINE"];
const children = [];
const mcpDirectory = mkdtempSync(join(tmpdir(), "forgecut-smoke-"));

function spawnChild(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    detached: process.platform !== "win32",
    ...options,
  });
  children.push(child);
  return child;
}

async function shutdown(code = 0) {
  for (const child of children) {
    try {
      if (process.platform === "win32") {
        child.kill();
      } else {
        process.kill(-child.pid, "SIGTERM");
      }
    } catch {
      child.kill();
    }
  }
  await Promise.all(
    children.map(async (child) => {
      if (child.exitCode === null && child.signalCode === null)
        await once(child, "close", { signal: AbortSignal.timeout(2000) }).catch(
          () => {},
        );
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }
    }),
  );
  await rm(mcpDirectory, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
  process.exit(code);
}

async function waitForPage() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const pages = await (await fetch(`${remoteDebuggingUrl}/json`)).json();
      const page = pages.find((candidate) => candidate.type === "page");
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Electron has not opened the debugging endpoint yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for Electron renderer debug endpoint");
}

async function connectCdp(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const errors = [];

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      errors.push(
        message.params.exceptionDetails?.exception?.description ??
          message.params,
      );
    }
    if (
      message.method === "Runtime.consoleAPICalled" &&
      message.params.type === "error"
    ) {
      errors.push(
        message.params.args
          .map((arg) => arg.description ?? arg.value)
          .join(" "),
      );
    }
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  const send = (method, params = {}) => {
    const callId = ++id;
    ws.send(JSON.stringify({ id: callId, method, params }));
    return new Promise((resolve) => pending.set(callId, resolve));
  };

  await send("Runtime.enable");
  await send("Page.enable");
  return { ws, send, errors };
}

async function main() {
  const executable = process.env.FORGECUT_VERIFY_EXECUTABLE;
  spawnChild(
    executable ?? "yarn",
    executable
      ? ["--no-sandbox", `--user-data-dir=${join(mcpDirectory, "profile")}`]
      : ["dev"],
    {
      env: {
        ...process.env,
        FORGECUT_MCP_DIR: mcpDirectory,
        FORGECUT_RESOURCE_DIR: join(mcpDirectory, "resources"),
        FORGECUT_DRAFT_DIR: join(mcpDirectory, "drafts"),
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
        ELECTRON_REMOTE_DEBUGGING_PORT: remoteDebuggingPort,
      },
    },
  );

  const page = await waitForPage();
  const { ws, send, errors } = await connectCdp(page.webSocketDebuggerUrl);
  await send("Page.reload", { ignoreCache: true });
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const result = await send("Runtime.evaluate", {
    expression: `({
      bridge: typeof window.forgecut,
      origin: window.location.origin,
      text: document.body.innerText,
      rootHtmlLength: document.getElementById("root")?.innerHTML.length ?? 0
    })`,
    returnByValue: true,
    awaitPromise: true,
  });

  await verifyAppearance(send, "empty");

  const editing = await send("Runtime.evaluate", {
    expression: `(async () => {
      const invoke = async (command, args) => {
        const response = await window.forgecut.invoke(command, args);
        if (!response.ok) throw new Error(response.error.message);
        return response.value;
      };
      const waitFor = async (predicate) => {
        for (let attempt = 0; attempt < 100; attempt++) {
          if (predicate()) return;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw new Error('Editor panels did not receive the project change');
      };
      await invoke('add_text_overlay', {
        trackId: crypto.randomUUID(), timelineStartUs: 0, durationUs: 3000000,
        text: 'Shared state check', fontSize: 48, color: '#ffffff', x: 100, y: 100,
      });
      await waitFor(() => document.querySelector('.clip-label')?.textContent === 'Shared state check');
      await waitFor(() => document.querySelector('.preview-viewport')?.textContent.includes('Shared state check'));
      await invoke('undo');
      await waitFor(() => !document.querySelector('.clip'));
      await invoke('redo');
      await waitFor(() => document.querySelector('.clip-label')?.textContent === 'Shared state check');
      const snapshot = await invoke('get_project_snapshot');
      const request = {
        sessionId: snapshot.sessionId, expectedRevision: snapshot.revision,
        requestId: crypto.randomUUID(), operations: [{ command: 'update_project', args: { name: 'Shared editor check' } }],
      };
      const first = await invoke('apply_edits', request);
      const retry = await invoke('apply_edits', request);
      if (first.revision !== retry.revision) throw new Error('A retried edit was applied twice');
      const stale = await window.forgecut.invoke('apply_edits', { ...request, requestId: crypto.randomUUID() });
      if (stale.ok || stale.error.code !== 'CONFLICT') throw new Error('Stale edit was accepted');
      await waitFor(() => document.querySelector('.project-name')?.textContent === 'Shared editor check');
      return { revision: first.revision, sharedEditing: true };
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (!editing.result?.result?.value?.sharedEditing) {
    throw new Error(
      `Shared editing smoke check failed: ${JSON.stringify(editing.result)}`,
    );
  }
  await verifyMcp(mcpDirectory, send);
  await verifyAudio(mcpDirectory, send);
  await verifyGraphicsPreview(mcpDirectory, send);
  await verifyCanvas(send);
  await verifyAppearance(send, "canvas");
  await verifyCode(send);
  await verifySequences(send);
  await verifyVariants(send);
  await verifySourceSelections(mcpDirectory, send);
  await verifyStylePresets(mcpDirectory, send);
  await verifyStyleControls(send);
  await verifyCredits(mcpDirectory, send);
  ws.close();

  const value = result.result?.result?.value;
  if (!value) throw new Error("Could not inspect renderer state");
  if (executable && value.origin !== "forgecut-app://editor")
    throw new Error(`Unexpected packaged editor origin: ${value.origin}`);
  if (value.bridge !== "object") {
    throw new Error(`ForgeCut preload bridge missing: ${value.bridge}`);
  }
  for (const text of expectedText) {
    if (!value.text.toUpperCase().includes(text)) {
      throw new Error(
        `Renderer did not contain expected text: ${text}\nRendered text:\n${value.text}`,
      );
    }
  }
  if (value.rootHtmlLength <= 0) {
    throw new Error("Renderer root is empty");
  }
  if (errors.length > 0) {
    throw new Error(`Renderer emitted errors:\\n${errors.join("\\n")}`);
  }

  console.log(
    "Electron startup, shared editing, live MCP, preview audio, graphics export and canvas editing verified",
  );
}

main()
  .then(() => shutdown(0))
  .catch((error) => {
    console.error(error);
    shutdown(1);
  });
