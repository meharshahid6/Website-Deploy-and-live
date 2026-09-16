import { cf, AppError } from "./http";
import type { Project } from "../shared/model";
export interface CFProject {
  id: string;
  name: string;
  subdomain: string;
  source?: { type: string; config: { repo_id: string; owner: string } };
}
export interface CFDeployment {
  id: string;
  url: string;
  environment: string;
  created_on: string;
  modified_on: string;
  latest_stage: { name: string; status: string; ended_on: string };
  deployment_trigger: {
    metadata: { commit_hash: string; commit_message: string; branch: string };
  };
  build_config: { build_command: string };
}
export async function verifyCloudflare(token: string) {
  const v = await cf<{ status: string }>(token, "/user/tokens/verify");
  if (v.status !== "active")
    throw new AppError(400, "TOKEN_INACTIVE", "Cloudflare token is not active");
  return cf<{ id: string; name: string }[]>(token, "/accounts?per_page=50");
}
export async function createPages(
  token: string,
  account: string,
  p: Project,
  ownerId: string,
) {
  const path = `/accounts/${account}/pages/projects`;
  let existing: CFProject | undefined;
  try {
    existing = await cf<CFProject>(token, `${path}/${p.name}`);
  } catch (e) {
    if (!(e instanceof AppError && e.status === 404)) throw e;
  }
  // A matching project may be recovered after a response was lost. Never mutate it here.
  if (existing) {
    if (existing.source?.config.repo_id !== String(p.repository_id))
      throw new AppError(
        409,
        "PAGES_EXISTS",
        "A Pages project with this name already exists for another source. Choose a different project name.",
      );
    return existing;
  }
  try {
    return await cf<CFProject>(token, path, "POST", {
      name: p.name,
      production_branch: p.production_branch,
      build_config: {
        build_command: p.build_command,
        root_dir: p.root_directory,
        destination_dir: p.output_directory,
      },
      source: {
        type: "github",
        config: {
          owner: p.repository_owner,
          owner_id: ownerId,
          repo_name: p.repository_name,
          repo_id: String(p.repository_id),
          production_branch: p.production_branch,
          production_deployments_enabled: true,
          preview_deployment_setting: "all",
        },
      },
    });
  } catch (e) {
    if (e instanceof AppError)
      throw new AppError(
        e.status,
        "PAGES_SETUP",
        "Pages could not connect this repository. Open Cloudflare → Workers & Pages → Create application → Pages → Connect to Git, authorize the Cloudflare GitHub app for this repository, then retry. Also check the project name and Pages Write permission.",
      );
    throw e;
  }
}
export interface Zone {
  id: string;
  name: string;
  status: string;
  name_servers: string[];
  account: { id: string };
}
export interface DNSRecord {
  id: string;
  name: string;
  type: string;
  content: string;
}
export interface CFDomain {
  name: string;
  status: string;
  validation_data?: { status: string };
  verification_data?: { status: string };
}
