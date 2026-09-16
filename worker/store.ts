import type { AppEnv } from "./env";
import type { Project } from "../shared/model";
import { encrypt, decrypt } from "./crypto";
import { AppError } from "./http";
export async function connection(e: AppEnv, provider: string) {
  const row = await e.DB.prepare("SELECT * FROM connections WHERE provider=?")
    .bind(provider)
    .first<{
      encrypted_token: string;
      provider_account_id: string;
      account_label: string;
      metadata: string;
    }>();
  if (!row)
    throw new AppError(
      400,
      "NOT_CONNECTED",
      `Connect ${provider} in Connections first.`,
    );
  return {
    ...row,
    token: await decrypt(row.encrypted_token, e.ENCRYPTION_KEY, provider),
  };
}
export async function saveConnection(
  e: AppEnv,
  provider: string,
  token: string,
  label: string,
  id: string,
  metadata: unknown = {},
) {
  const now = new Date().toISOString();
  await e.DB.prepare(
    "INSERT INTO connections(provider,encrypted_token,account_label,provider_account_id,metadata,created_time,updated_time,last_verified_time) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET encrypted_token=excluded.encrypted_token,account_label=excluded.account_label,provider_account_id=excluded.provider_account_id,metadata=excluded.metadata,updated_time=excluded.updated_time,last_verified_time=excluded.last_verified_time",
  )
    .bind(
      provider,
      await encrypt(token, e.ENCRYPTION_KEY, provider),
      label,
      id,
      JSON.stringify(metadata),
      now,
      now,
      now,
    )
    .run();
}
export async function project(e: AppEnv, id: string) {
  const p = await e.DB.prepare("SELECT * FROM projects WHERE id=?")
    .bind(id)
    .first<Project>();
  if (!p) throw new AppError(404, "NOT_FOUND", "Project not found");
  return p;
}
export async function log(
  e: AppEnv,
  id: string | null,
  action: string,
  status: string,
  details: Record<string, string | number> = {},
) {
  await e.DB.prepare("INSERT INTO activity_logs VALUES(?,?,?,?,?,?)")
    .bind(
      crypto.randomUUID(),
      id,
      action,
      status,
      JSON.stringify(details),
      new Date().toISOString(),
    )
    .run();
}
export async function lock<T>(e: AppEnv, id: string, fn: () => Promise<T>) {
  const now = Date.now();
  const result = await e.DB.prepare(
    "UPDATE projects SET lock_until=? WHERE id=? AND lock_until<?",
  )
    .bind(now + 180000, id, now)
    .run();
  if (!result.meta.changes)
    throw new AppError(
      409,
      "BUSY",
      "Another operation is running. Wait before retrying.",
    );
  try {
    return await fn();
  } finally {
    await e.DB.prepare("UPDATE projects SET lock_until=0 WHERE id=?")
      .bind(id)
      .run();
  }
}
export async function budget(e: AppEnv) {
  const month = new Date().toISOString().slice(0, 7);
  const row = await e.DB.prepare(
    "SELECT COUNT(*) AS count FROM activity_logs WHERE action='build_requested' AND timestamp>=?",
  )
    .bind(month + "-01")
    .first<{ count: number }>();
  return row?.count ?? 0;
}
export async function reserveBuild(e: AppEnv, id: string) {
  const month = new Date().toISOString().slice(0, 7) + "-01";
  const result = await e.DB.prepare(
    "INSERT INTO activity_logs SELECT ?,?,'build_requested','reserved','{}',? WHERE (SELECT COUNT(*) FROM activity_logs WHERE action='build_requested' AND timestamp>=?)<500",
  )
    .bind(crypto.randomUUID(), id, new Date().toISOString(), month)
    .run();
  if (!result.meta.changes)
    throw new AppError(
      429,
      "BUILD_BUDGET",
      "LaunchDock’s monthly build budget is exhausted. Check Cloudflare usage and wait for next month.",
    );
}
