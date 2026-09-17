const KEY_STORAGE = "launchdock_secret_key";

export function getStoredKey(): string {
  try {
    return (
      sessionStorage.getItem(KEY_STORAGE) ||
      localStorage.getItem(KEY_STORAGE) ||
      ""
    );
  } catch {
    return "";
  }
}

export function setStoredKey(key: string, persist = true) {
  try {
    if (persist) {
      localStorage.setItem(KEY_STORAGE, key);
      sessionStorage.removeItem(KEY_STORAGE);
    } else {
      sessionStorage.setItem(KEY_STORAGE, key);
      localStorage.removeItem(KEY_STORAGE);
    }
  } catch {
    // Ignore storage errors
  }
}

export function clearStoredKey() {
  try {
    localStorage.removeItem(KEY_STORAGE);
    sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    // Ignore storage errors
  }
}

export async function checkAuthStatus(): Promise<{
  locked: boolean;
  authType: string;
  local: boolean;
}> {
  const headers: Record<string, string> = {
    "X-LaunchDock": "1",
  };
  const key = getStoredKey();
  if (key) headers["X-LaunchDock-Key"] = key;
  const res = await fetch("/api/auth/status", { headers });
  if (!res.ok) return { locked: true, authType: "key", local: false };
  const body = (await res.json()) as {
    data: { locked: boolean; authType: string; local: boolean };
  };
  return body.data;
}

export async function unlockWorkspace(
  key: string,
  persist = true,
): Promise<void> {
  const res = await fetch("/api/auth/unlock", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-LaunchDock": "1",
    },
    body: JSON.stringify({ key: key.trim() }),
  });
  let data: { error?: { message?: string } } = {};
  try {
    data = await res.json();
  } catch {
    // ignore
  }
  if (!res.ok) {
    throw new Error(data.error?.message || "Invalid secret key");
  }
  setStoredKey(key.trim(), persist);
}

export async function lockWorkspace(): Promise<void> {
  clearStoredKey();
  try {
    await fetch("/api/auth/lock", {
      method: "POST",
      headers: { "X-LaunchDock": "1" },
    });
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent("launchdock:auth-required"));
}

export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-LaunchDock": "1",
  };
  const key = getStoredKey();
  if (key) {
    headers["X-LaunchDock-Key"] = key;
  }
  const r = await fetch("/api" + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let result: { data: T; error?: { code?: string; message: string } };
  try {
    result = await r.json();
  } catch {
    throw new Error(
      "The API could not be reached. Check your connection and sign in again.",
    );
  }
  if (!r.ok) {
    if (
      r.status === 401 &&
      (result.error?.code === "AUTH_REQUIRED" ||
        result.error?.message?.includes("Secret Key"))
    ) {
      window.dispatchEvent(new CustomEvent("launchdock:auth-required"));
    }
    throw new Error(result.error?.message ?? "Request failed");
  }
  return result.data;
}
