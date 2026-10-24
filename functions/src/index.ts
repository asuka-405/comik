import { onRequest, type Request } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { Response } from "express";
import { app } from "../../server/app";

/**
 * Comic source proxy for your own Firebase project.
 *
 * Browsers cannot read most comic sites directly (no CORS headers, referer checks), so the web
 * build sends source requests here. The request runs from your project's Google Cloud IP address,
 * not from a shared Comik address, and only signed-in users of your project may use it.
 *
 *   GET  https://<region>-<project>.cloudfunctions.net/comikProxy/health
 *   ANY  .../comikProxy/fetch?url=...   page and API requests
 *   GET  .../comikProxy/img?url=...     images
 *
 * Credentials: `Authorization: Bearer <Firebase ID token>`, or `?t=<ID token>` for <img> tags,
 * which cannot send headers.
 *
 * Optional: set ALLOWED_EMAILS (comma separated) in functions/.env to limit use to those Google accounts.
 */

export type VerifyToken = (token: string) => Promise<{ email?: string; email_verified?: boolean }>;

const allowedEmails = () =>
  (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

function json(res: Response, origin: string | undefined, status: number, body: unknown) {
  // Without CORS headers the browser would hide the 401 behind a generic network error.
  if (origin) res.setHeader("access-control-allow-origin", origin);
  res.status(status).setHeader("content-type", "application/json").send(JSON.stringify(body));
}

export function createHandler(verify: VerifyToken) {
  return async (req: Request, res: Response): Promise<void> => {
    const url = new URL(req.originalUrl || req.url, "https://proxy.invalid");
    // The function is mounted at its own name, so /comikProxy/fetch arrives here as /fetch.
    const route = url.pathname.replace(/^\/comikProxy(?=\/|$)/, "") || "/";
    const target = new URL(`/api${route}${url.search}`, "https://proxy.invalid");

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string" && key !== "authorization") headers.set(key, value);
      else if (Array.isArray(value) && key !== "authorization") headers.set(key, value.join(", "));
    }

    if (req.method !== "OPTIONS" && route !== "/health") {
      const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ""))?.[1];
      const token = bearer ?? target.searchParams.get("t") ?? "";
      if (!token) return json(res, req.headers.origin, 401, { error: "Sign in to use this proxy." });
      try {
        const claims = await verify(token);
        const allow = allowedEmails();
        if (allow.length && !(claims.email && claims.email_verified && allow.includes(claims.email.toLowerCase()))) {
          return json(res, req.headers.origin, 403, { error: "This account is not allowed to use this proxy." });
        }
      } catch {
        return json(res, req.headers.origin, 401, { error: "Your sign-in expired. Reload and try again." });
      }
      target.searchParams.delete("t");
    }

    const body = req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS" ? undefined : (req.rawBody ?? undefined);
    const response = await app.fetch(new Request(target, { method: req.method, headers, body: body as BodyInit | undefined }));
    response.headers.forEach((value, key) => {
      if (key !== "content-length" && key !== "content-encoding") res.setHeader(key, value);
    });
    res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
  };
}

initializeApp();

export const comikProxy = onRequest(
  {
    // Invoked by browsers without IAM credentials. The handler authenticates every real request itself.
    invoker: "public",
    cors: false,
    memory: "512MiB",
    timeoutSeconds: 60,
    maxInstances: 5,
  },
  createHandler((token) => getAuth().verifyIdToken(token)),
);
