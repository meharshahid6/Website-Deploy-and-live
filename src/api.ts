export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json", "X-LaunchDock": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let result: { data: T; error?: { message: string } };
  try {
    result = await r.json();
  } catch {
    throw new Error(
      "The API could not be reached. Check your connection and sign in again.",
    );
  }
  if (!r.ok) throw new Error(result.error?.message ?? "Request failed");
  return result.data;
}
