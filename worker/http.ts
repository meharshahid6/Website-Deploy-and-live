export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function provider<T>(
  url: string,
  token: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "LaunchDock",
      "X-GitHub-Api-Version": "2026-03-10",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
    redirect: "error",
  });
  if (!r.ok) {
    await r.body?.cancel();
    throw new AppError(
      r.status === 404 ? 404 : r.status === 409 || r.status === 422 ? 409 : 502,
      `PROVIDER_${r.status}`,
      r.status === 401 || r.status === 403
        ? "Provider authorization failed. Reconnect and check permissions."
        : r.status === 429
          ? "Provider rate limit reached. Wait before retrying."
          : r.status === 404
            ? "Provider resource not found."
            : r.status === 422 || r.status === 409
              ? "Provider conflict. Check repository access, branch or project name before retrying."
              : "Provider request failed. Check the provider dashboard.",
    );
  }
  if (r.status === 204) return undefined as T;
  return r.json() as Promise<T>;
}
export const gh = <T>(
  token: string,
  path: string,
  method = "GET",
  body?: unknown,
) => provider<T>("https://api.github.com" + path, token, method, body);
export async function cf<T>(
  token: string,
  path: string,
  method = "GET",
  body?: unknown,
) {
  const r = await provider<{ success: boolean; result: T }>(
    "https://api.cloudflare.com/client/v4" + path,
    token,
    method,
    body,
  );
  if (!r.success)
    throw new AppError(
      502,
      "CLOUDFLARE",
      "Cloudflare rejected the request. Verify permissions and GitHub installation.",
    );
  return r.result;
}
