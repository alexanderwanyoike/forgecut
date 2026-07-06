import { spawn } from "node:child_process";

const remoteDebuggingPort = String(19_222 + Math.floor(Math.random() * 1000));
const remoteDebuggingUrl = `http://127.0.0.1:${remoteDebuggingPort}`;
const expectedText = ["TIMELINE", "No clip at playhead"];
const children = [];

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

function shutdown(code = 0) {
  for (const child of children) {
    if (child.killed) continue;
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
      errors.push(message.params.exceptionDetails?.exception?.description ?? message.params);
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      errors.push(message.params.args.map((arg) => arg.description ?? arg.value).join(" "));
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
  spawnChild("yarn", ["dev"], {
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      ELECTRON_REMOTE_DEBUGGING_PORT: remoteDebuggingPort,
    },
  });

  const page = await waitForPage();
  const { ws, send, errors } = await connectCdp(page.webSocketDebuggerUrl);
  await send("Page.reload", { ignoreCache: true });
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const result = await send("Runtime.evaluate", {
    expression: `({
      bridge: typeof window.forgecut,
      text: document.body.innerText,
      rootHtmlLength: document.getElementById("root")?.innerHTML.length ?? 0
    })`,
    returnByValue: true,
    awaitPromise: true,
  });
  ws.close();

  const value = result.result?.result?.value;
  if (!value) throw new Error("Could not inspect renderer state");
  if (value.bridge !== "object") {
    throw new Error(`ForgeCut preload bridge missing: ${value.bridge}`);
  }
  for (const text of expectedText) {
    if (!value.text.includes(text)) {
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

  console.log("Electron startup verified");
}

main()
  .then(() => shutdown(0))
  .catch((error) => {
    console.error(error);
    shutdown(1);
  });
