import type { GraphicResource } from "../shared/graphic-resources.js";
import { readGraphicResource } from "./graphic-resource-store.js";

export async function graphicResourceResponse(
  resources: GraphicResource[],
  requestUrl: string,
): Promise<Response> {
  const url = new URL(requestUrl);
  const hash = url.pathname.slice(1);
  if (!/^[a-f0-9]{64}$/.test(hash))
    return new Response("Invalid resource identity", { status: 400 });
  const resource = resources.find((candidate) => candidate.sha256 === hash);
  if (!resource)
    return new Response("Resource is not part of this project", {
      status: 403,
    });
  const read = await readGraphicResource(resource);
  if (!read.ok) return new Response(read.error.message, { status: 404 });
  return new Response(new Uint8Array(read.value), {
    headers: {
      "content-type": resource.mime,
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}
