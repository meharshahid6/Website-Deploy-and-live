import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppEnv } from "./env";
import { AppError } from "./http";
import { LIMITS } from "../shared/validation";
let keySet:
  | { issuer: string; resolve: ReturnType<typeof createRemoteJWKSet> }
  | undefined;
export function local(r: Request, e: AppEnv) {
  const u = new URL(r.url);
  return (
    e.LOCAL_DEV === "true" &&
    ["127.0.0.1", "localhost"].includes(u.hostname) &&
    u.protocol === "http:"
  );
}
export async function authorize(r: Request, e: AppEnv) {
  if (local(r, e)) return "local";
  if (!e.ACCESS_TEAM_DOMAIN || !e.ACCESS_AUD || !e.OWNER_EMAIL)
    throw new AppError(
      503,
      "ACCESS_SETUP",
      "Dashboard is locked. Configure Cloudflare Access and the owner email before use.",
    );
  const token = r.headers.get("Cf-Access-Jwt-Assertion");
  if (!token)
    throw new AppError(
      401,
      "UNAUTHORIZED",
      "Sign in through Cloudflare Access.",
    );
  try {
    const issuer = `https://${e.ACCESS_TEAM_DOMAIN}`;
    if (!keySet || keySet.issuer !== issuer)
      keySet = {
        issuer,
        resolve: createRemoteJWKSet(new URL(issuer + "/cdn-cgi/access/certs")),
      };
    const { payload } = await jwtVerify(token, keySet.resolve, {
      issuer,
      audience: e.ACCESS_AUD,
      algorithms: ["RS256"],
    });
    if (
      typeof payload.email !== "string" ||
      payload.email.toLowerCase() !== e.OWNER_EMAIL.toLowerCase()
    )
      throw new Error();
    return payload.email;
  } catch {
    throw new AppError(
      403,
      "FORBIDDEN",
      "This dashboard is restricted to its owner.",
    );
  }
}
export function csrf(r: Request, e: AppEnv) {
  if (!["GET", "HEAD", "OPTIONS"].includes(r.method)) {
    // The local Worker also serves built assets on 8787. Accept only that
    // exact same origin, not arbitrary localhost ports or external origins.
    const sameLocalOrigin =
      local(r, e) && r.headers.get("Origin") === new URL(r.url).origin;
    if (
      (r.headers.get("Origin") !== e.APP_ORIGIN && !sameLocalOrigin) ||
      r.headers.get("X-LaunchDock") !== "1"
    )
      throw new AppError(
        403,
        "CSRF",
        "Request origin could not be verified. Open the dashboard at its configured address and try again.",
      );
  }
}
export async function jsonBody(r: Request) {
  if (!r.headers.get("Content-Type")?.startsWith("application/json"))
    throw new AppError(415, "CONTENT_TYPE", "Use application/json");
  if (Number(r.headers.get("Content-Length")) > LIMITS.request)
    throw new AppError(413, "BODY_TOO_LARGE", "Upload is too large");
  const reader = r.body?.getReader();
  if (!reader)
    throw new AppError(400, "BODY_REQUIRED", "Request body required");
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > LIMITS.request) {
      await reader.cancel();
      throw new AppError(413, "BODY_TOO_LARGE", "Upload is too large");
    }
    chunks.push(value);
  }
  const b = new Uint8Array(n);
  let i = 0;
  for (const c of chunks) {
    b.set(c, i);
    i += c.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(b)) as unknown;
  } catch {
    throw new AppError(400, "INVALID_JSON", "Invalid JSON body");
  }
}
export const headers = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
