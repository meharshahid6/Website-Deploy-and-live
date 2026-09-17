import { z } from "zod";
import { domainInfo } from "../shared/validation";
import { cf, provider, AppError } from "./http";
import { connection, log } from "./store";
import type { AppEnv } from "./env";
import type { Project } from "../shared/model";
import { pagesHostname, type Zone, type DNSRecord, type CFDomain } from "./cloudflare";
export const domainInput = z
  .object({
    domain: z.string().max(253),
    action: z.enum(["inspect", "create-zone", "attach", "nameservers"]),
    confirm: z.boolean().default(false),
    previous: z.array(z.string()).max(10).optional(),
    dnsReviewed: z.boolean().default(false),
  })
  .strict();
export async function hostDomains(token: string) {
  return provider<unknown>(
    "https://developers.hostinger.com/api/domains/v1/portfolio",
    token,
  );
}
export async function domainAction(
  e: AppEnv,
  p: Project,
  input: z.infer<typeof domainInput>,
) {
  if (!p.cloudflare_project_name)
    throw new AppError(
      400,
      "PAGES_REQUIRED",
      "Create the Pages project before connecting a domain.",
    );
  const d = domainInfo(input.domain),
    c = await connection(e, "cloudflare");
  if (c.provider_account_id !== p.cloudflare_account_id)
    throw new AppError(
      409,
      "ACCOUNT_CHANGED",
      "Select the Cloudflare account used by this project.",
    );
  const zones = await cf<Zone[]>(
    c.token,
    `/zones?name=${encodeURIComponent(d.apex)}&account.id=${c.provider_account_id}`,
  );
  let zone = zones[0];
  if (input.action !== "inspect" && !input.confirm)
    throw new AppError(
      400,
      "CONFIRM_REQUIRED",
      "Confirm the exact domain change first.",
    );
  if (!zone && input.action === "create-zone") {
    zone = await cf<Zone>(c.token, "/zones", "POST", {
      name: d.apex,
      account: { id: c.provider_account_id },
      type: "full",
    });
    await log(e, p.id, "zone_created", "success", { domain: d.apex });
  }
  let records: DNSRecord[] = [];
  if (zone)
    records = await cf<DNSRecord[]>(
      c.token,
      `/zones/${zone.id}/dns_records?name=${encodeURIComponent(d.name)}&per_page=100`,
    );
  const doh = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(d.apex)}&type=NS`,
    {
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(10000),
    },
  );
  const dns = (await doh.json()) as {
    Answer?: { type: number; data: string }[];
  };
  const current = (dns.Answer ?? [])
    .filter((x) => x.type === 2)
    .map((x) => x.data.replace(/\.$/, "").toLowerCase())
    .sort();
  if (input.action === "nameservers") {
    if (!zone || !input.dnsReviewed)
      throw new AppError(
        400,
        "DNS_REVIEW",
        "Review existing DNS records, mail records and DNSSEC before changing delegation.",
      );
    if (
      JSON.stringify([...(input.previous ?? [])].sort()) !==
      JSON.stringify(current)
    )
      throw new AppError(
        409,
        "NAMESERVERS_CHANGED",
        "Nameservers changed since review. Refresh and confirm again.",
      );
    const h = await connection(e, "hostinger");
    const registrar = await provider<{ name_servers: Record<string, string> }>(
      `https://developers.hostinger.com/api/domains/v1/portfolio/${encodeURIComponent(d.apex)}`,
      h.token,
    );
    const actual = Object.values(registrar.name_servers ?? {})
      .filter(Boolean)
      .map((n) => n.replace(/\.$/, "").toLowerCase())
      .sort();
    if (!actual.length || JSON.stringify(actual) !== JSON.stringify(current))
      throw new AppError(
        409,
        "REGISTRAR_CHANGED",
        "Hostinger nameservers differ from public DNS. Review the current settings in hPanel and wait for DNS to catch up, or use the manual wizard. No nameservers were changed.",
      );
    await provider(
      `https://developers.hostinger.com/api/domains/v1/portfolio/${encodeURIComponent(d.apex)}/nameservers`,
      h.token,
      "PUT",
      { ns1: zone.name_servers[0], ns2: zone.name_servers[1] },
    );
    await log(e, p.id, "nameservers_updated", "success", { domain: d.apex });
  }
  if (input.action === "attach") {
    if (!zone)
      throw new AppError(
        400,
        "ZONE_REQUIRED",
        "Create or authorize the Cloudflare zone first.",
      );
    const target = await pagesHostname(c.token, c.provider_account_id, p.cloudflare_project_name);
    const existingCname = records.find((r) => r.type === "CNAME" && r.name === d.name);
    const hasUnrelated = records.some(
      (r) => ["A", "AAAA"].includes(r.type) && r.name === d.name,
    );
    if (hasUnrelated)
      throw new AppError(
        409,
        "DNS_CONFLICT",
        "Existing website records point elsewhere. LaunchDock will not replace them. Review them in Cloudflare first.",
      );
    if (
      existingCname &&
      !existingCname.content.endsWith(".pages.dev") &&
      existingCname.content !== target
    )
      throw new AppError(
        409,
        "DNS_CONFLICT",
        "Existing website records point elsewhere. LaunchDock will not replace them. Review them in Cloudflare first.",
      );

    try {
      const allProjects = await cf<{ name: string }[]>(
        c.token,
        `/accounts/${c.provider_account_id}/pages/projects`,
      );
      for (const other of allProjects) {
        if (other.name !== p.cloudflare_project_name) {
          try {
            const otherDomains = await cf<CFDomain[]>(
              c.token,
              `/accounts/${c.provider_account_id}/pages/projects/${other.name}/domains`,
            );
            if (otherDomains.some((x) => x.name === d.name)) {
              await cf(
                c.token,
                `/accounts/${c.provider_account_id}/pages/projects/${other.name}/domains/${encodeURIComponent(d.name)}`,
                "DELETE",
              );
            }
          } catch {}
        }
      }
    } catch {}

    const base = `/accounts/${c.provider_account_id}/pages/projects/${p.cloudflare_project_name}/domains`;
    const attached = await cf<CFDomain[]>(c.token, base);
    if (!attached.some((x) => x.name === d.name))
      await cf(c.token, base, "POST", { name: d.name });
    if (existingCname) {
      if (existingCname.content !== target) {
        await cf(c.token, `/zones/${zone.id}/dns_records/${existingCname.id}`, "PUT", {
          type: "CNAME",
          name: d.name,
          content: target,
          proxied: true,
          ttl: 1,
        });
      }
    } else {
      await cf(c.token, `/zones/${zone.id}/dns_records`, "POST", {
        type: "CNAME",
        name: d.name,
        content: target,
        proxied: true,
        ttl: 1,
      });
    }
    await e.DB.prepare(
      "UPDATE projects SET custom_domain=?,zone_id=?,updated_time=? WHERE id=?",
    )
      .bind(d.name, zone.id, new Date().toISOString(), p.id)
      .run();
    await log(e, p.id, "domain_attached", "success", { domain: d.name });
  }
  let domain: CFDomain | null = null;
  try {
    domain = await cf<CFDomain>(
      c.token,
      `/accounts/${c.provider_account_id}/pages/projects/${p.cloudflare_project_name}/domains/${d.name}`,
    );
  } catch (err) {
    if (!(err instanceof AppError && err.status === 404)) throw err;
  }
  const assigned = zone?.name_servers ?? [];
  return {
    ...d,
    zone: zone ? { id: zone.id, status: zone.status } : null,
    nameservers: assigned,
    previous: current,
    records: records.map((r) => ({
      name: r.name,
      type: r.type,
      content: r.content,
    })),
    delegationActive:
      assigned.length > 0 && assigned.every((n) => current.includes(n)),
    domainStatus: domain?.status ?? "not-attached",
    sslStatus:
      domain?.status === "active"
        ? "active"
        : (domain?.validation_data?.status ?? "pending"),
    liveUrl: domain?.status === "active" ? `https://${d.name}` : null,
  };
}
