export interface SourceFile {
  path: string;
  content: string;
  encoding: "utf-8" | "base64";
}
export interface Project {
  last_deployment_time?: string | null;
  latest_preview_url?: string | null;
  id: string;
  name: string;
  description: string;
  framework_type: string;
  repository_owner: string | null;
  repository_name: string;
  repository_id: string | null;
  production_branch: string;
  cloudflare_account_id: string | null;
  cloudflare_project_name: string | null;
  cloudflare_project_id: string | null;
  build_command: string;
  root_directory: string;
  output_directory: string;
  custom_domain: string | null;
  zone_id: string | null;
  project_status: string;
  private: number;
  last_commit_sha: string | null;
  last_commit_message: string | null;
  created_time: string;
  updated_time: string;
}
export interface Connection {
  provider: string;
  account_label: string;
  provider_account_id: string;
  last_verified_time: string;
  metadata: string;
}
export interface Deployment {
  id: string;
  project_id: string;
  provider_deployment_id: string;
  commit_sha: string;
  commit_message: string;
  environment: string;
  status: string;
  preview_url: string;
  production_url: string;
  error_summary: string;
  started_time: string;
  completed_time: string;
  build_command: string;
  branch: string;
}
