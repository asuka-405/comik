import { app } from "../../server/index";

interface NetlifyEvent {
  httpMethod: string;
  path: string;
  rawUrl?: string;
  headers: Record<string, string | undefined>;
  body: string | null;
  isBase64Encoded?: boolean;
}

export async function handler(event: NetlifyEvent) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers)) if (value) headers.set(key, value);
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost";
  const protocol = headers.get("x-forwarded-proto") ?? "https";
  const requestUrl = new URL(event.rawUrl ?? event.path, `${protocol}://${host}`);
  const functionPrefix = "/.netlify/functions/comik-api";
  if (requestUrl.pathname.startsWith(functionPrefix)) {
    const suffix = requestUrl.pathname.slice(functionPrefix.length).replace(/^\/+/, "");
    requestUrl.pathname = `/api/${suffix}`;
  } else if (!requestUrl.pathname.startsWith("/api/")) {
    requestUrl.pathname = `/api/${requestUrl.pathname.replace(/^\/+/, "")}`;
  }

  const init: RequestInit = { method: event.httpMethod, headers };
  if (event.body && event.httpMethod !== "GET" && event.httpMethod !== "HEAD") {
    init.body = event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body;
  }
  const response = await app.fetch(new Request(requestUrl, init));
  const responseHeaders = Object.fromEntries(response.headers.entries());
  const contentType = response.headers.get("content-type") ?? "";
  const bytes = Buffer.from(await response.arrayBuffer());
  const binary = contentType.startsWith("image/") || contentType === "application/octet-stream";

  return {
    statusCode: response.status,
    headers: responseHeaders,
    body: binary ? bytes.toString("base64") : bytes.toString("utf8"),
    isBase64Encoded: binary,
  };
}