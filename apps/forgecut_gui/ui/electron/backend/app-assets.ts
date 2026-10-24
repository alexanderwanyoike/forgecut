import { realpath, readFile, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute, extname } from "node:path";

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
const csp =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: forgecut-resource:; font-src 'self' data: forgecut-resource:; media-src forgecut-media: blob:; connect-src 'self' forgecut-resource: forgecut-media:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

function inside(root: string, path: string): boolean {
  const remainder = relative(root, path);
  return (
    remainder !== ".." &&
    !remainder.startsWith("../") &&
    !remainder.startsWith("..\\") &&
    !isAbsolute(remainder)
  );
}

export async function appAssetResponse(
  directory: string,
  address: string,
): Promise<Response> {
  let path: string;
  try {
    const url = new URL(address);
    if (
      url.protocol !== "forgecut-app:" ||
      url.host !== "editor" ||
      url.username ||
      url.password
    )
      return new Response("Invalid app origin", { status: 400 });
    path = decodeURIComponent(url.pathname).slice(1) || "index.html";
    if (path.includes("\0"))
      return new Response("Invalid app path", { status: 400 });
  } catch {
    return new Response("Invalid app URL", { status: 400 });
  }
  const candidate = resolve(directory, path);
  if (!inside(resolve(directory), candidate))
    return new Response("App path denied", { status: 403 });
  const mime = mimeTypes[extname(candidate).toLowerCase()];
  if (!mime) return new Response("App asset not found", { status: 404 });
  try {
    const root = await realpath(directory);
    const actual = await realpath(candidate);
    if (!inside(root, actual))
      return new Response("App path denied", { status: 403 });
    const metadata = await stat(actual);
    if (!metadata.isFile())
      return new Response("App asset not found", { status: 404 });
    if (metadata.size > 32 * 1024 * 1024)
      return new Response("App asset exceeds 32 MiB", { status: 413 });
    return new Response(Uint8Array.from(await readFile(actual)), {
      headers: {
        "Content-Type": mime,
        "Content-Security-Policy": csp,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("App asset not found", { status: 404 });
  }
}
