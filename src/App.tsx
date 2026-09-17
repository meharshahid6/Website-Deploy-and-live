import {
  useState,
  useEffect,
  useRef,
  useCallback,
  lazy,
  Suspense,
  Component,
  type ReactNode,
} from "react";
import {
  Rocket,
  LayoutDashboard,
  FolderGit2,
  Plug,
  Plus,
  ArrowUpRight,
  GitBranch,
  Globe,
  ShieldCheck,
  Activity,
  ChevronRight,
  Cloud,
  ExternalLink,
  RefreshCw,
  Upload,
  FileArchive,
  Folder,
  FileCode2,
  Check,
  AlertCircle,
  Copy,
  Menu,
  X,
  Trash2,
  CheckCircle2,
} from "lucide-react";
import { api } from "./api";
import { importFiles, importZip, starter, type ImportReport } from "./import";
import { detect, projectInput, LIMITS } from "../shared/validation";
import type {
  Project,
  Connection,
  Deployment,
  SourceFile,
} from "../shared/model";
import { set, del } from "idb-keyval";
const Editor = lazy(() => import("./Editor"));
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error)
      return (
        <div className="empty">
          <AlertCircle size={40} />
          <h2>Something went wrong</h2>
          <p>{this.state.error.message}</p>
          <Button
            primary
            onClick={() => {
              this.setState({ error: null });
              location.hash = "dashboard";
            }}
          >
            Return to dashboard
          </Button>
        </div>
      );
    return this.props.children;
  }
}
interface Toast {
  id: number;
  message: string;
  type: "success" | "error";
}
let toastId = 0;
function Toasts({
  items,
  onDismiss,
}: {
  items: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="toast-container">
      {items.map((t) => (
        <div key={t.id} className={"toast " + t.type}>
          {t.type === "success" ? (
            <CheckCircle2 size={16} />
          ) : (
            <AlertCircle size={16} />
          )}
          <span>{t.message}</span>
          <button aria-label="Dismiss" onClick={() => onDismiss(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
export function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <button
      className={primary ? "button primary" : "button"}
      disabled={disabled}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
}
export function Badge({ status }: { status: string }) {
  return (
    <span className={"badge " + status}>
      <i />
      {status.replaceAll("-", " ")}
    </span>
  );
}
export function Link({
  url,
  children,
}: {
  url?: string | null;
  children: ReactNode;
}) {
  if (!url || !/^https:\/\//.test(url)) return null;
  return (
    <a
      className="text-link"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
      <ArrowUpRight size={14} />
    </a>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export default function App() {
  const [view, setView] = useState(
      location.hash.slice(1).split("/")[0] || "dashboard",
    ),
    [projects, setProjects] = useState<Project[]>([]),
    [connections, setConnections] = useState<Connection[]>([]),
    [usage, setUsage] = useState({
      initiated: 0,
      limit: 500,
      providerTotal: null,
    }),
    [selected, setSelected] = useState<Project | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [mobile, setMobile] = useState(false),
    [local, setLocal] = useState(false),
    [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((message: string, type: "success" | "error" = "success") => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  const dismissToast = useCallback(
    (id: number) => setToasts((t) => t.filter((x) => x.id !== id)),
    [],
  );
  async function refresh() {
    try {
      const [p, c, u] = await Promise.all([
        api<Project[]>("/projects"),
        api<{ connections: Connection[]; local: boolean }>("/connections"),
        api<typeof usage>("/usage"),
      ]);
      setProjects(p);
      const projectId = location.hash.slice(1).split("/")[1];
      if (projectId)
        setSelected(p.find((item) => item.id === projectId) ?? null);
      setConnections(c.connections);
      setLocal(c.local);
      setUsage(u);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    const h = () => {
      setView(location.hash.slice(1).split("/")[0] || "dashboard");
      void refresh();
    };
    addEventListener("hashchange", h);
    return () => removeEventListener("hashchange", h);
  }, []);
  const go = (v: string, p?: Project) => {
    if (p) setSelected(p);
    setView(v);
    location.hash = v + (p ? "/" + p.id : "");
    setMobile(false);
    setError("");
  };
  const run = async (fn: () => Promise<void>) => {
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const navigateProject = (p: Project, v = "editor") => go(v, p);
  const deleteProject = async (p: Project) => {
    const hasRepo = p.repository_owner && p.repository_name;
    const hasCF = p.cloudflare_project_name;
    let msg = `Permanently delete "${p.name}"?`;
    if (hasRepo || hasCF) {
      msg += "\n\nThis will permanently delete:";
      if (hasRepo)
        msg += `\n• GitHub repository (${p.repository_owner}/${p.repository_name})`;
      if (hasCF)
        msg += `\n• Cloudflare Pages project (${p.cloudflare_project_name})`;
      msg += "\n• LaunchDock project and deployment history";
    }
    msg += "\n\nAre you sure? This cannot be undone.";
    if (!confirm(msg)) return;
    try {
      toast(`Deleting "${p.name}" and removing provider resources...`);
      const res = await api<{
        deleted: boolean;
        cloudflare?: boolean;
        github?: boolean;
      }>("/projects/" + p.id, "DELETE", { confirm: true });
      await del("draft:" + p.id);
      if (selected?.id === p.id) setSelected(null);
      let doneMsg = `Project "${p.name}" deleted`;
      if (res.github && res.cloudflare)
        doneMsg += " (removed from GitHub & Cloudflare Pages)";
      else if (res.github) doneMsg += " (removed from GitHub)";
      else if (res.cloudflare) doneMsg += " (removed from Cloudflare Pages)";
      toast(doneMsg);
      await refresh();
      go("dashboard");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <ErrorBoundary>
    <div className="app">
      <Toasts items={toasts} onDismiss={dismissToast} />
      <aside className={mobile ? "sidebar open" : "sidebar"}>
        <a className="brand" href="#dashboard">
          <span className="brand-icon">
            <Rocket size={21} />
          </span>
          LaunchDock<span className="brand-dot">.</span>
        </a>
        <div className="workspace">
          <span className="avatar">P</span>
          <div>
            Personal workspace<small>Single-user · Free plan</small>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {[
            { id: "dashboard", name: "Overview", icon: LayoutDashboard },
            { id: "projects", name: "Projects", icon: FolderGit2 },
            { id: "connections", name: "Connections", icon: Plug },
          ].map((n) => (
            <button
              key={n.id}
              className={view === n.id ? "nav active" : "nav"}
              onClick={() => go(n.id)}
            >
              <n.icon size={18} />
              {n.name}
              {n.id === "projects" && <span>{projects.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="free-note">
            <ShieldCheck size={18} />
            <div>
              Your space. Your code.
              <small>
                {local
                  ? "Local development access"
                  : "Protected by Cloudflare Access"}
              </small>
            </div>
          </div>
          <a
            href="https://github.com/settings/developers"
            target="_blank"
            rel="noreferrer"
          >
            Provider settings
            <ExternalLink size={14} />
          </a>
          <div className="profile">
            <span className="avatar small">
              {connections
                .find((c) => c.provider === "github")
                ?.account_label.slice(0, 1)
                .toUpperCase() ?? "P"}
            </span>
            <div>
              {connections.find((c) => c.provider === "github")
                ?.account_label ?? "Personal account"}
              <small>{local ? "Local development" : "Private workspace"}</small>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <div className="shell">
        <header className="topbar">
          <button
            className="mobile-toggle"
            aria-label="Toggle navigation"
            onClick={() => setMobile(!mobile)}
          >
            {mobile ? <X /> : <Menu />}
          </button>
          <span>Workspace</span>
          <ChevronRight size={14} />
          <strong>
            {view === "editor"
              ? (selected?.name ?? "Editor")
              : view === "new"
                ? "New project"
                : view === "domain"
                  ? "Custom domain"
                  : view === "deployments"
                    ? "Deployment details"
                    : view[0]?.toUpperCase() + view.slice(1)}
          </strong>
          <span className="top-status">
            <span className="online-dot" />
            {local ? "Local development" : "Private dashboard"}
          </span>
        </header>
        <main>
          {error && (
            <div className="alert error" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="empty">
              <RefreshCw className="spin" />
              <h2>Opening your workspace…</h2>
            </div>
          ) : (
            <>
              {(view === "dashboard" || view === "projects") && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">YOUR DEPLOYMENT WORKSPACE</div>
                      <h1>
                        {view === "dashboard"
                          ? "Ready when you are."
                          : "Your projects"}
                      </h1>
                      <p>Ship websites without the setup maze.</p>
                    </div>
                    <Button primary onClick={() => go("new")}>
                      <Plus size={17} />
                      New project
                    </Button>
                  </div>
                  <div className="stats">
                    <div className="stat">
                      <span>
                        Projects
                        <FolderGit2 size={17} />
                      </span>
                      <strong>
                        {projects.length}
                        <small>in your workspace</small>
                      </strong>
                    </div>
                    <div className="stat">
                      <span>
                        Connected services
                        <Plug size={17} />
                      </span>
                      <strong>
                        {connections.length}
                        <small>of 3 providers</small>
                      </strong>
                    </div>
                    <div className="stat">
                      <span>
                        Builds initiated this month
                        <Activity size={17} />
                      </span>
                      <strong>
                        {usage.initiated}
                        <small>/ {usage.limit} free monthly builds</small>
                      </strong>
                      <div className="meter">
                        <i
                          style={{
                            width: Math.min(100, (usage.initiated / usage.limit) * 100) + "%",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  {usage.initiated >= 400 && (
                    <div className="alert">
                      You’re approaching your monthly build budget. Batch
                      changes before pushing.
                    </div>
                  )}
                  <div className="section-heading">
                    <h2>
                      {view === "dashboard"
                        ? "Recent projects"
                        : "All projects"}{" "}
                      <span>{projects.length}</span>
                    </h2>
                    <span className="muted">
                      GitHub is your source of truth
                    </span>
                  </div>
                  {!projects.length ? (
                    <div className="empty project-empty">
                      <div className="empty-icon">
                        <FolderGit2 size={30} />
                      </div>
                      <h2>A home for your next launch.</h2>
                      <p>
                        Bring an HTML file, a folder, or a ZIP.
                        <br />
                        Edit, connect, and publish from one place.
                      </p>
                      <Button primary onClick={() => go("new")}>
                        <Plus size={16} />
                        Create your first project
                      </Button>
                      <small>
                        Files stay on your device until you publish.
                      </small>
                    </div>
                  ) : (
                    <div className="project-grid">
                      {projects.map((p) => (
                        <article className="project-card" key={p.id}>
                          <div className="row">
                            <span className="project-icon">
                              <FileCode2 size={23} />
                            </span>
                            <Badge status={p.project_status} />
                          </div>
                          <h3>
                            <button onClick={() => navigateProject(p)}>
                              {p.name}
                            </button>
                          </h3>
                          <p>
                            {p.description ||
                              `${p.framework_type === "static" ? "Static website" : p.framework_type + " project"} · ${p.private ? "Private" : "Public"} repository`}
                          </p>
                          <div className="project-meta">
                            <GitBranch size={14} />
                            {p.production_branch}
                            <span>·</span>
                            {p.last_commit_sha?.slice(0, 7) ?? "Not published"}
                          </div>
                          <div className="project-meta">
                            <Cloud size={14} />
                            {p.cloudflare_project_name ?? "Pages not connected"}
                          </div>
                          <div className="project-meta">
                            <Globe size={14} />
                            {p.custom_domain ??
                              (p.latest_production_url?.replace("https://", "") ?? "No live domain yet")}
                          </div>
                          {p.last_deployment_time && (
                            <div className="project-meta">
                              Last deployment{" "}
                              {new Date(
                                p.last_deployment_time,
                              ).toLocaleString()}
                            </div>
                          )}
                          {p.last_commit_message && (
                            <small className="commit-message">
                              {p.last_commit_message}
                            </small>
                          )}
                          <div className="card-actions">
                            <Button onClick={() => navigateProject(p)}>
                              Edit code
                            </Button>
                            <Button
                              onClick={() => navigateProject(p, "deployments")}
                            >
                              Deploy
                              <ArrowUpRight size={14} />
                            </Button>
                            <button
                              className="card-delete"
                              aria-label={"Delete " + p.name}
                              onClick={() => void deleteProject(p)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <div className="row links">
                            <Link
                              url={
                                p.repository_owner
                                  ? `https://github.com/${p.repository_owner}/${p.repository_name}`
                                  : null
                              }
                            >
                              Repository
                            </Link>
                            <Link url={p.latest_preview_url}>Preview</Link>
                            {p.project_status === "live" && (
                              <Link
                                url={p.latest_production_url}
                              >
                                Live website
                              </Link>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                  <div className="bottom-grid">
                    <div className="panel">
                      <h3>
                        <Plug size={18} />
                        Your connections
                      </h3>
                      <p>Connect once. Keep your next launch simple.</p>
                      <div className="connection-summary">
                        {["github", "cloudflare", "hostinger"].map((p) => (
                          <div key={p}>
                            <span className="provider-mark">
                              {p === "github" ? (
                                <GitBranch size={17} />
                              ) : p === "cloudflare" ? (
                                <Cloud size={17} />
                              ) : (
                                <Globe size={17} />
                              )}
                            </span>
                            <span>{p[0].toUpperCase() + p.slice(1)}</span>
                            <Badge
                              status={
                                connections.some((c) => c.provider === p)
                                  ? "connected"
                                  : "not-connected"
                              }
                            />
                          </div>
                        ))}
                      </div>
                      <button
                        className="plain-link"
                        onClick={() => go("connections")}
                      >
                        Manage connections
                        <ArrowUpRight size={15} />
                      </button>
                    </div>
                    <div className="panel getting-started">
                      <span className="eyebrow">A CLEAR PATH TO LIVE</span>
                      <h3>From a folder to the web.</h3>
                      {[
                        "Import your website",
                        "Make it yours in the editor",
                        "Publish to GitHub & Cloudflare",
                      ].map((t, i) => (
                        <div className="step-line" key={t}>
                          <span>{i + 1}</span>
                          {t}
                        </div>
                      ))}
                      <small>
                        No mandatory monthly subscription. Domain renewal is
                        optional.
                      </small>
                    </div>
                  </div>
                  <p className="footnote">
                    Usage counts LaunchDock requests only; it is not an
                    account-wide Cloudflare meter.{" "}
                    <Link url="https://dash.cloudflare.com/">
                      Check provider usage
                    </Link>
                  </p>
                </>
              )}
              {view === "new" && (
                <Wizard
                  onCreated={(p) => {
                    void refresh();
                    navigateProject(p);
                  }}
                  onError={setError}
                />
              )}
              {view === "connections" && (
                <Connections
                  connections={connections}
                  refresh={refresh}
                  run={run}
                />
              )}
              {view === "editor" &&
                (selected ? (
                  <Suspense
                    fallback={
                      <div className="empty">Loading Monaco Editor…</div>
                    }
                  >
                    <Editor
                      key={selected.id}
                      project={selected}
                      onError={setError}
                      onUpdated={async () => {
                        await refresh();
                        const p = await api<Project>(
                          "/projects/" + selected.id,
                        );
                        setSelected(p);
                      }}
                      onDeploy={() => go("deployments", selected)}
                    />
                  </Suspense>
                ) : (
                  <div className="empty">
                    <h2>Select a project to edit</h2>
                    <Button onClick={() => go("projects")}>
                      Open projects
                    </Button>
                  </div>
                ))}
              {view === "deployments" &&
                (selected ? (
                  <Deployments
                    project={selected}
                    run={run}
                    onDomain={() => go("domain", selected)}
                    onUpdate={(p) => setSelected(p)}
                  />
                ) : (
                  <div className="empty">Select a project from Projects.</div>
                ))}
              {view === "domain" &&
                (selected ? (
                  <DomainWizard
                    project={selected}
                    connections={connections}
                    run={run}
                  />
                ) : (
                  <div className="empty">Select a project first.</div>
                ))}
            </>
          )}
        </main>
      </div>
    </div>
    </ErrorBoundary>
  );
}
function Wizard({
  onCreated,
  onError,
}: {
  onCreated: (p: Project) => void;
  onError: (s: string) => void;
}) {
  const [step, setStep] = useState(0),
    [report, setReport] = useState<ImportReport | null>(null),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [repo, setRepo] = useState(""),
    [privacy, setPrivacy] = useState(true),
    [build, setBuild] = useState(""),
    [root, setRoot] = useState(""),
    [out, setOut] = useState(""),
    [branch, setBranch] = useState("main");
  async function imported(fn: () => Promise<ImportReport>) {
    setBusy(true);
    onError("");
    try {
      const r = await fn();
      setReport(r);
      const d = detect(r.files);
      setBuild(d.build_command);
      setOut(d.output_directory);
      setStep(1);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (!report) return;
    setBusy(true);
    onError("");
    try {
      const d = detect(report.files);
      const input = projectInput.parse({
        name,
        repository_name: repo || name,
        private: privacy,
        framework_type: d.framework_type,
        build_command: build,
        root_directory: root,
        output_directory: out,
        production_branch: branch,
      });
      const p = await api<Project>("/projects", "POST", input);
      await set("draft:" + p.id, { files: report.files, base: [], head: null });
      onCreated(p);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">NEW PROJECT</div>
        <h1>What are you shipping?</h1>
        <p>
          Start with your files. You’ll review everything before publishing.
        </p>
      </div>
      <div className="wizard-steps">
        {["Import", "Review files", "Configure"].map((x, i) => (
          <span key={x} className={step >= i ? "current" : ""}>
            <b>{step > i ? <Check size={13} /> : i + 1}</b>
            {x}
          </span>
        ))}
      </div>
      {step === 0 && (
        <div className="panel">
          <h2>Bring your website</h2>
          <p className="muted">
            500 files · 2 MiB per file · 8 MiB total. Dependencies and secrets
            are filtered.
          </p>
          <div className="upload-grid">
            {[
              {
                kind: "files",
                title: "Files",
                text: "An HTML file or a selection",
                icon: Upload,
              },
              {
                kind: "folder",
                title: "Website folder",
                text: "Preserve your directory structure",
                icon: Folder,
              },
              {
                kind: "zip",
                title: "ZIP archive",
                text: "Extract and validate locally",
                icon: FileArchive,
              },
            ].map((k) => (
              <label className="upload-option" key={k.kind}>
                <k.icon size={29} />
                <strong>{k.title}</strong>
                <span>{k.text}</span>
                <input
                  disabled={busy}
                  aria-label={"Upload " + k.kind}
                  type="file"
                  multiple={k.kind !== "zip"}
                  accept={k.kind === "zip" ? ".zip" : undefined}
                  {...(k.kind === "folder" ? { webkitdirectory: "" } : {})}
                  onChange={(e) => {
                    const f = e.target.files;
                    if (!f?.length) return;
                    void imported(async () =>
                      k.kind === "zip"
                        ? importZip(new Uint8Array(await f[0].arrayBuffer()))
                        : importFiles(f, k.kind === "folder"),
                    );
                  }}
                />
              </label>
            ))}
            <button
              className="upload-option"
              disabled={busy}
              onClick={() =>
                void imported(async () => ({
                  files: structuredClone(starter),
                  items: starter.map((f) => ({
                    path: f.path,
                    status: "accepted",
                    reason: "",
                  })),
                }))
              }
            >
              <Rocket size={29} />
              <strong>Starter project</strong>
              <span>A clean HTML + CSS starting point</span>
            </button>
          </div>
          <div className="privacy-note">
            <ShieldCheck size={18} />
            Nothing is sent to GitHub or Cloudflare until you press Publish.
          </div>
        </div>
      )}
      {step === 1 && report && (
        <div className="panel">
          <div className="row">
            <h2>Review your import</h2>
            <Badge status={detect(report.files).framework_type} />
          </div>
          <p>
            {report.files.length} accepted files ·{" "}
            {report.items.filter((f) => f.status === "ignored").length} ignored
            · {report.items.filter((f) => f.status === "blocked").length}{" "}
            blocked
          </p>
          <div className="import-list">
            {report.items.map((f, i) => (
              <div key={i}>
                <FileCode2 size={15} />
                <code>{f.path}</code>
                <small>{f.reason}</small>
                <Badge status={f.status} />
              </div>
            ))}
          </div>
          <div className="form-actions">
            <Button onClick={() => setStep(0)}>Back</Button>
            <Button primary onClick={() => setStep(2)}>
              Continue
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="panel form-panel">
          <h2>Make it your project</h2>
          <div className="form-grid">
            <Field label="Project name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-website"
              />
            </Field>
            <Field
              label="Repository name"
              hint="Existing repositories will never be overwritten."
            >
              <input
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder={name || "my-website"}
              />
            </Field>
            <Field label="Repository visibility">
              <select
                value={privacy ? "private" : "public"}
                onChange={(e) => setPrivacy(e.target.value === "private")}
              >
                <option>private</option>
                <option>public</option>
              </select>
            </Field>
            <Field label="Production branch">
              <input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />
            </Field>
            <Field
              label="Build command"
              hint="Leave blank for a static website. Runs on Cloudflare, never locally."
            >
              <input
                value={build}
                onChange={(e) => setBuild(e.target.value)}
                placeholder="npm run build"
              />
            </Field>
            <Field label="Root directory">
              <input
                value={root}
                onChange={(e) => setRoot(e.target.value)}
                placeholder="Repository root"
              />
            </Field>
            <Field
              label="Output directory"
              hint="Framework projects must produce static output for Pages."
            >
              <input
                value={out}
                onChange={(e) => setOut(e.target.value)}
                placeholder="Repository root"
              />
            </Field>
          </div>
          <div className="alert">
            Next, review code and choose “Publish to GitHub”. You can deploy
            immediately after the commit or keep it as a repository.
          </div>
          <div className="form-actions">
            <Button onClick={() => setStep(1)}>Back</Button>
            <Button
              primary
              disabled={busy || !name}
              onClick={() => void create()}
            >
              {busy ? "Creating…" : "Open in editor"}
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
function Connections({
  connections,
  refresh,
  run,
}: {
  connections: Connection[];
  refresh: () => Promise<void>;
  run: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [setup, setSetup] = useState<{
    githubReady: boolean;
    appOrigin: string;
    callbackUrl: string;
    local: boolean;
  } | null>(null);
  async function checkSetup() {
    const result = await api<{ setup: NonNullable<typeof setup> }>(
      "/connections",
    );
    setSetup(result.setup);
  }
  useEffect(() => {
    void run(checkSetup);
  }, []);
  const [tokens, setTokens] = useState({ cloudflare: "", hostinger: "" }),
    [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]),
    [account, setAccount] = useState(""),
    [busy, setBusy] = useState(false);
  async function connect(provider: "cloudflare" | "hostinger") {
    setBusy(true);
    await run(async () => {
      const r = await api<{
        selectAccount?: boolean;
        accounts?: typeof accounts;
      }>("/connections/" + provider, "POST", {
        token: tokens[provider],
        ...(account && provider === "cloudflare" ? { accountId: account } : {}),
      });
      if (r.selectAccount) {
        setAccounts(r.accounts!);
        setAccount(r.accounts![0].id);
        return;
      }
      setTokens((t) => ({ ...t, [provider]: "" }));
      setAccounts([]);
      await refresh();
    });
    setBusy(false);
  }
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">CONNECTIONS</div>
        <h1>Your tools, connected.</h1>
        <p>Credentials are encrypted. Provider access stays on the server.</p>
      </div>
      {location.search.includes("oauth=failed") && (
        <div className="alert error">
          GitHub authorization failed or expired. Check the callback URL and try
          again.
        </div>
      )}
      <div className="connection-cards">
        {(["github", "cloudflare", "hostinger"] as const).map((provider) => {
          const c = connections.find((c) => c.provider === provider);
          return (
            <section className="panel" key={provider}>
              <div className="row">
                <div className={"provider-logo " + provider}>
                  {provider === "github" ? (
                    <GitBranch />
                  ) : provider === "cloudflare" ? (
                    <Cloud />
                  ) : (
                    <Globe />
                  )}
                </div>
                <Badge status={c ? "connected" : "not-connected"} />
              </div>
              <h2>
                {provider === "github"
                  ? "GitHub"
                  : provider === "cloudflare"
                    ? "Cloudflare"
                    : "Hostinger"}
              </h2>
              <p>
                {provider === "github"
                  ? "Your repositories and version history."
                  : provider === "cloudflare"
                    ? "Free Pages hosting and custom domains."
                    : "Optional registrar access for your domains."}
              </p>
              {c && (
                <div className="connection-detail">
                  <strong>{c.account_label}</strong>
                  <small>
                    Last verified{" "}
                    {new Date(c.last_verified_time).toLocaleString()}
                  </small>
                </div>
              )}
              {provider === "github" ? (
                <>
                  <p className="muted">
                    Uses a GitHub OAuth App with <code>repo</code> scope to
                    create and update private repositories. This scope also
                    permits access to other repositories; connect only your
                    personal account. Workflows are blocked on import.
                  </p>
                  {setup?.githubReady ? (
                    <a className="button primary" href="/api/auth/github/start">
                      {c ? "Reconnect GitHub" : "Authorize GitHub"}
                      <ArrowUpRight size={16} />
                    </a>
                  ) : (
                    <div className="manual-guide">
                      <h3>One-time GitHub setup required</h3>
                      <p>
                        Signing in alone cannot connect this app. First register
                        LaunchDock as a GitHub OAuth App.
                      </p>
                      <ol>
                        <li>
                          <Link url="https://github.com/settings/applications/new">
                            Register GitHub OAuth App
                          </Link>
                        </li>
                        <li>
                          Name: <strong>LaunchDock Personal</strong>
                        </li>
                        <li>
                          Homepage URL:{" "}
                          <code>{setup?.appOrigin ?? "Checking…"}</code>
                        </li>
                        <li>
                          Authorization callback URL:{" "}
                          <code style={{ overflowWrap: "anywhere" }}>
                            {setup?.callbackUrl ?? "Checking…"}
                          </code>
                        </li>
                        <li>
                          {setup?.local ? (
                            <>
                              In this project's PowerShell terminal run{" "}
                              <code>npm run setup:github</code>. Enter the
                              Client ID and Client Secret only in its prompts,
                              then restart <code>npm run dev</code>.
                            </>
                          ) : (
                            <>
                              Store GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET
                              through Wrangler secret prompts. Never enter the
                              secret in chat.
                            </>
                          )}
                        </li>
                      </ol>
                      <Button onClick={() => void run(checkSetup)}>
                        Check GitHub setup
                      </Button>
                      <Button disabled>
                        Authorize GitHub — setup required
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <Field
                    label={c ? "Replacement API token" : "API token"}
                    hint="Enter here, never in chat. Cleared after a successful connection."
                  >
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={tokens[provider]}
                      onChange={(e) =>
                        setTokens((t) => ({ ...t, [provider]: e.target.value }))
                      }
                      placeholder="Paste your scoped token"
                    />
                  </Field>
                  {provider === "cloudflare" ? (
                    <>
                      <div className="manual-guide">
                        <h3>Create a scoped user token</h3>
                        <p>
                          Open the token page below, then choose{" "}
                          <strong>
                            Create Token → Create Custom Token → Get started
                          </strong>
                          . Name it LaunchDock. Do not use Global API Key or
                          Account API Token with this form.
                        </p>
                        <p>
                          Select your intended account under Account Resources.
                          After reviewing permissions, choose Continue to
                          summary → Create Token, then paste the token here.
                        </p>
                      </div>
                      <details open>
                        <summary>Required Cloudflare permissions</summary>
                        <ul>
                          <li>
                            Account → Cloudflare Pages → Edit (Pages Write)
                          </li>
                          <li>
                            Account → Account Settings → Read (account
                            selection)
                          </li>
                          <li>Zone → Zone → Read; add Edit to create zones</li>
                          <li>Zone → DNS → Edit (custom domains only)</li>
                        </ul>
                        <p>
                          Use a user API token scoped to your selected account
                          and intended zones. Never use a Global API Key. New
                          zone creation needs permission covering that new zone.
                        </p>
                      </details>
                      <Link url="https://dash.cloudflare.com/profile/api-tokens">
                        Create API token
                      </Link>
                      {accounts.length > 0 && (
                        <Field label="Select Cloudflare account">
                          <select
                            value={account}
                            onChange={(e) => setAccount(e.target.value)}
                          >
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="muted">
                        Hostinger tokens inherit your account’s permissions.
                        Domain listing verifies access. Nameserver changes
                        require a separate confirmation. If your account cannot
                        use the API, use the manual domain wizard.
                      </p>
                      <Link url="https://hpanel.hostinger.com/profile/api">
                        Create Hostinger token
                      </Link>
                    </>
                  )}
                  <Button
                    primary
                    disabled={busy || !tokens[provider]}
                    onClick={() => void connect(provider)}
                  >
                    {busy
                      ? "Verifying…"
                      : c
                        ? "Replace token"
                        : "Verify & connect"}
                  </Button>
                </>
              )}
              {c && (
                <div className="form-actions">
                  <Button
                    onClick={() =>
                      void run(async () => {
                        await api(
                          "/connections/" + provider + "/verify",
                          "POST",
                          {},
                        );
                      })
                    }
                  >
                    <RefreshCw size={14} />
                    Verify
                  </Button>
                  <Button
                    onClick={() => {
                      if (
                        confirm(
                          "Disconnect " +
                            provider +
                            "? Existing repositories and deployments will remain.",
                        )
                      )
                        void run(async () => {
                          await api("/connections/" + provider, "DELETE");
                        });
                    }}
                  >
                    Disconnect
                  </Button>
                </div>
              )}
            </section>
          );
        })}
      </div>
      <div className="panel">
        <h3>
          <ShieldCheck size={18} />
          One-time setup
        </h3>
        <p>
          GitHub requires a personal OAuth App. Cloudflare Pages also requires
          its own GitHub integration.
        </p>
        <Link url="https://github.com/settings/developers">
          GitHub OAuth settings
        </Link>{" "}
        <Link url="https://dash.cloudflare.com/?to=/:account/pages">
          Cloudflare Git integration
        </Link>
        <p className="muted">
          See the included README for callback URLs, secret entry and Cloudflare
          Access protection.
        </p>
      </div>
    </>
  );
}
function Deployments({
  project: p,
  run,
  onDomain,
  onUpdate,
}: {
  project: Project;
  run: (f: () => Promise<void>) => Promise<void>;
  onDomain: () => void;
  onUpdate: (p: Project) => void;
}) {
  const [rows, setRows] = useState<Deployment[]>([]),
    [busy, setBusy] = useState(false),
    [pollCycle, setPollCycle] = useState(0),
    [pollError, setPollError] = useState("");
  const retrying = useRef<string | null>(null);
  async function refresh() {
    const d = await api<Deployment[]>(
      `/projects/${p.id}/deployments?refresh=1`,
    );
    setRows(d);
    onUpdate(await api<Project>("/projects/" + p.id));
    setPollError("");
    return d;
  }
  useEffect(() => {
    let cancelled = false,
      t: ReturnType<typeof setTimeout>,
      delay = 5000;
    async function tick() {
      try {
        const d = await refresh();
        if (cancelled) return;
        if (
          d[0] &&
          d[0].id !== retrying.current &&
          ["successful", "failed", "cancelled"].includes(d[0].status)
        )
          return;
        if (
          d[0] &&
          !["successful", "failed", "cancelled"].includes(d[0].status)
        )
          retrying.current = null;
      } catch (e) {
        if (!cancelled) setPollError((e as Error).message);
      }
      if (!cancelled) {
        delay = Math.min(delay * 1.6, 60000);
        t = setTimeout(() => void tick(), delay);
      }
    }
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [p.id, p.cloudflare_project_name, pollCycle]);
  async function deploy() {
    setBusy(true);
    await run(async () => {
      await api("/projects/" + p.id + "/deploy", "POST", { confirm: true });
      onUpdate(await api<Project>("/projects/" + p.id));
      await refresh();
    });
    setBusy(false);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">DEPLOYMENTS / {p.name}</div>
          <h1>Follow your launch.</h1>
          <p>
            A successful commit is the start. Cloudflare confirms when your site
            is live.
          </p>
        </div>
        <Button onClick={onDomain}>
          <Globe size={16} />
          Connect domain
        </Button>
      </div>
      {pollError && <div className="alert error">{pollError}</div>}
      <div className="panel">
        <div className="row">
          <h2>{p.name}</h2>
          <Badge status={p.project_status} />
        </div>
        <div className="detail-grid">
          <div>
            <small>Git repository</small>
            <Link
              url={
                p.repository_owner
                  ? `https://github.com/${p.repository_owner}/${p.repository_name}`
                  : null
              }
            >
              {p.repository_name}
            </Link>
          </div>
          <div>
            <small>Branch</small>
            <code>{p.production_branch}</code>
          </div>
          <div>
            <small>Build command</small>
            <code>{p.build_command || "None — static files"}</code>
          </div>
          <div>
            <small>Output</small>
            <code>{p.output_directory || "Repository root"}</code>
          </div>
          <div>
            <small>Latest commit</small>
            <code>{p.last_commit_sha ?? "Not published"}</code>
            <p>{p.last_commit_message}</p>
          </div>
        </div>
        <div className="form-actions">
          {!p.cloudflare_project_name && (
            <Button
              primary
              disabled={busy || !p.last_commit_sha}
              onClick={() => void deploy()}
            >
              {busy ? "Connecting…" : "Create Pages & deploy"}
            </Button>
          )}
          <Button
            onClick={() =>
              void run(async () => {
                await refresh();
              })
            }
          >
            <RefreshCw size={15} />
            Refresh status
          </Button>
          <Link
            url={
              p.cloudflare_account_id
                ? `https://dash.cloudflare.com/${p.cloudflare_account_id}/pages/view/${p.cloudflare_project_name}`
                : "https://dash.cloudflare.com/?to=/:account/pages"
            }
          >
            Cloudflare details
          </Link>
        </div>
        <p className="muted">
          If Git authorization is missing, open Cloudflare → Workers & Pages →
          Create application → Pages → Connect to Git. Grant the Cloudflare
          GitHub app access to this repository, then retry here.
        </p>
      </div>
      <h2 className="section-title">Deployment history</h2>
      {!rows.length ? (
        <div className="empty panel">
          <Cloud size={30} />
          <h3>No deployment reported yet</h3>
          <p>
            Publish to GitHub, then create your Pages project. Status appears
            when Cloudflare returns a deployment.
          </p>
        </div>
      ) : (
        rows.map((d) => (
          <div className="panel deployment" key={d.id}>
            <div className="row">
              <h3>{d.commit_message || "Deployment"}</h3>
              <Badge status={d.status} />
            </div>
            <div className="project-meta">
              <GitBranch size={15} />
              {d.branch} · {d.commit_sha?.slice(0, 7)} · {d.environment}
            </div>
            <p className="muted">
              Started {new Date(d.started_time).toLocaleString()}
              {d.completed_time &&
                ` · Duration ${Math.max(0, Math.round((Date.parse(d.completed_time) - Date.parse(d.started_time)) / 1000))}s`}
            </p>
            {d.error_summary && (
              <div className="alert error">{d.error_summary}</div>
            )}
            <div className="row links">
              <Link url={d.preview_url}>Open preview</Link>
              <Link url={d.production_url}>Open live website</Link>
              {["failed", "cancelled", "successful"].includes(d.status) && (
                <Button
                  onClick={() => {
                    if (
                      confirm(
                        "Retry this deployment? This uses one build from your monthly allowance.",
                      )
                    )
                      void run(async () => {
                        await api("/projects/" + p.id + "/redeploy", "POST", {
                          deploymentId: d.provider_deployment_id,
                          confirm: true,
                        });
                        retrying.current = d.id;
                        setPollCycle((n) => n + 1);
                        await refresh();
                      });
                  }}
                >
                  Retry deployment
                </Button>
              )}
            </div>
          </div>
        ))
      )}
    </>
  );
}
interface DomainState {
  name: string;
  apex: string;
  isApex: boolean;
  zone: { id: string; status: string } | null;
  nameservers: string[];
  previous: string[];
  records: { name: string; type: string; content: string }[];
  delegationActive: boolean;
  domainStatus: string;
  sslStatus: string;
  liveUrl: string | null;
}
function DomainWizard({
  project: p,
  connections,
  run,
}: {
  project: Project;
  connections: Connection[];
  run: (f: () => Promise<void>) => Promise<void>;
}) {
  const [domain, setDomain] = useState(p.custom_domain ?? ""),
    [state, setState] = useState<DomainState | null>(null),
    [reviewed, setReviewed] = useState(false),
    [owned, setOwned] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [pollCycle, setPollCycle] = useState(0),
    [copied, setCopied] = useState("");
  const host = connections.some((c) => c.provider === "hostinger");
  async function act(action: string) {
    setBusy(true);
    await run(async () => {
      setState(
        await api<DomainState>(`/projects/${p.id}/domain`, "POST", {
          domain,
          action,
          confirm: action !== "inspect",
          previous: state?.previous,
          dnsReviewed: reviewed,
        }),
      );
    });
    setBusy(false);
    setPollCycle((n) => n + 1);
  }
  useEffect(() => {
    if (!state || (state.domainStatus === "active" && state.delegationActive))
      return;
    const t = setTimeout(() => void act("inspect"), 30000);
    return () => clearTimeout(t);
  }, [state, pollCycle]);
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">CUSTOM DOMAIN / {p.name}</div>
        <h1>A familiar address.</h1>
        <p>
          Keep Hostinger as your registrar. Let Cloudflare serve your website.
        </p>
      </div>
      <div className="panel form-panel">
        <h2>1. Choose your domain</h2>
        {host && (
          <Button
            onClick={() =>
              void run(async () => {
                const r = await api<unknown>("/hostinger/domains");
                const list = Array.isArray(r)
                  ? r
                  : ((r as { data?: unknown[] })?.data ?? []);
                setOwned(
                  list
                    .map((x) => (x as { domain: string }).domain)
                    .filter(Boolean),
                );
              })
            }
          >
            Load Hostinger domains
          </Button>
        )}
        {owned.length > 0 && (
          <Field label="Owned domains">
            <select
              onChange={(e) => {
                setDomain(e.target.value);
                setState(null);
              }}
            >
              <option value="">Choose a domain</option>
              {owned.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </Field>
        )}
        <Field
          label="Domain or subdomain"
          hint="For example, example.com or portfolio.example.com"
        >
          <input
            value={domain}
            onChange={(e) => {
              setDomain(e.target.value);
              setState(null);
              setReviewed(false);
            }}
          />
        </Field>
        <Button
          primary
          disabled={busy || !domain}
          onClick={() => void act("inspect")}
        >
          Check domain
        </Button>
        {state && (
          <>
            <hr />
            <h2>2. Cloudflare zone</h2>
            <p>
              <code>{state.name}</code> is{" "}
              {state.isApex ? "the apex domain" : "a subdomain"} of{" "}
              <code>{state.apex}</code>.
            </p>
            {state.zone ? (
              <Badge status={state.zone.status} />
            ) : (
              <>
                <p>No accessible zone exists in your selected account.</p>
                <Button
                  onClick={() => {
                    if (
                      confirm(
                        `Create a free Cloudflare zone for ${state.apex}?`,
                      )
                    )
                      void act("create-zone");
                  }}
                >
                  Create free zone
                </Button>
              </>
            )}
            {state.zone && (
              <>
                <h2>3. Review nameservers</h2>
                <div className="detail-grid">
                  <div>
                    <small>Previous / current public nameservers</small>
                    {state.previous.map((n) => (
                      <code className="ns" key={n}>
                        {n}
                      </code>
                    ))}
                  </div>
                  <div>
                    <small>Assigned Cloudflare nameservers</small>
                    {state.nameservers.map((n) => (
                      <div className="ns row" key={n}>
                        <code>{n}</code>
                        <Button
                          aria-label={"Copy " + n}
                          onClick={() =>
                            void run(async () => {
                              await navigator.clipboard.writeText(n);
                              setCopied(n);
                            })
                          }
                        >
                          <Copy size={14} />
                          {copied === n ? "Copied" : "Copy"}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
                <details>
                  <summary>Existing records at this exact hostname</summary>
                  <pre>
                    {state.records.length
                      ? JSON.stringify(state.records, null, 2)
                      : "No records found."}
                  </pre>
                </details>
                {state.delegationActive ? (
                  <div
                    className="alert"
                    style={{
                      borderColor: "#22c55e",
                      background: "rgba(34, 197, 94, 0.1)",
                      color: "#86efac",
                    }}
                  >
                    <CheckCircle2 size={18} />
                    <span>
                      Nameserver delegation is active! Your domain is routed
                      through Cloudflare.
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="alert">
                      Changing nameservers affects the whole domain, including email
                      and other subdomains. Copy existing DNS records into
                      Cloudflare first. Check DNSSEC with your registrar before
                      switching.
                    </div>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={reviewed}
                        onChange={(e) => setReviewed(e.target.checked)}
                      />
                      I reviewed all existing DNS and mail records and the DNSSEC
                      setting.
                    </label>
                    {host && (
                      <Button
                        primary
                        disabled={!reviewed || busy}
                        onClick={() => {
                          if (
                            confirm(
                              `Replace Hostinger nameservers for ${state.apex}\nFROM: ${state.previous.join(", ")}\nTO: ${state.nameservers.join(", ")}?`,
                            )
                          )
                            void act("nameservers");
                        }}
                      >
                        Update through Hostinger API
                      </Button>
                    )}
                    <details className="manual-guide" style={{ marginTop: "14px" }}>
                      <summary
                        style={{
                          cursor: "pointer",
                          color: "var(--muted)",
                          fontSize: "12px",
                          marginBottom: "10px",
                        }}
                      >
                        Manual option (one-time setup)
                      </summary>
                      <ol>
                        <li>
                          Open Hostinger hPanel → Domains → Domain portfolio →
                          Manage your apex domain.
                        </li>
                        <li>Open DNS / Nameservers → Change nameservers.</li>
                        <li>
                          Choose custom nameservers and enter both Cloudflare values
                          shown above.
                        </li>
                        <li>
                          Save in Hostinger, then return here. Leave existing
                          records intact in Cloudflare.
                        </li>
                      </ol>
                      <Link url="https://hpanel.hostinger.com/domains">
                        Open Hostinger
                      </Link>
                      <p className="muted">
                        Use this option if API access is unavailable. Delegation is
                        checked against public DNS every 30 seconds while this
                        wizard is open.
                      </p>
                    </details>
                  </>
                )}
                <h2>4. Attach & verify</h2>
                <div className="status-row">
                  Nameserver delegation{" "}
                  <Badge
                    status={state.delegationActive ? "active" : "pending"}
                  />
                </div>
                <div className="status-row">
                  Pages custom domain <Badge status={state.domainStatus} />
                </div>
                <div className="status-row">
                  SSL certificate <Badge status={state.sslStatus} />
                </div>
                <div className="form-actions">
                  <Button
                    primary
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          `Attach ${state.name} to ${p.cloudflare_project_name} and update DNS?`,
                        )
                      )
                        void act("attach");
                    }}
                  >
                    Attach to Pages
                  </Button>
                  <Button disabled={busy} onClick={() => void act("inspect")}>
                    Check again
                  </Button>
                  <Link url={state.liveUrl}>Open live website</Link>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
