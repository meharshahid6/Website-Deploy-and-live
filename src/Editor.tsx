import { useEffect, useState, useMemo, useRef } from "react";
import Monaco from "@monaco-editor/react";
import { DiffView } from "./DiffView";
import { get, set } from "idb-keyval";
import { zipSync } from "fflate";
import {
  FilePlus2,
  FolderPlus,
  Search,
  Save,
  Upload,
  Download,
  Eye,
  Code2,
  GitCompareArrows,
  FileCode2,
  Trash2,
  Copy,
  PenLine,
  Folder,
  ChevronRight,
} from "lucide-react";
import { api } from "./api";
import { Button, Field, Badge } from "./App";
import type { Project, SourceFile } from "../shared/model";
import {
  safePath,
  validateFiles,
  bytes,
  classifyPath,
  LIMITS,
} from "../shared/validation";
import { source } from "./import";
import { blobId } from "../shared/blob-id";
import { previewHTML } from "./preview";
import "./monaco";
interface Draft {
  files: SourceFile[];
  base: SourceFile[];
  head: string | null;
}
const language = (path: string) =>
  ({
    html: "html",
    htm: "html",
    css: "css",
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    json: "json",
    md: "markdown",
    svg: "xml",
    yml: "yaml",
    yaml: "yaml",
  })[path.split(".").at(-1)!] ?? "plaintext";
function Preview({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const send = () =>
    ref.current?.contentWindow?.postMessage(
      { type: "launchdock-preview", html },
      "*",
    );
  useEffect(send, [html]);
  return (
    <iframe
      className="preview-frame"
      title="Sandboxed website preview"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      src="/preview.html"
      ref={ref}
      onLoad={send}
    />
  );
}
export default function Editor({
  project: p,
  onError,
  onUpdated,
  onDeploy,
}: {
  project: Project;
  onError: (s: string) => void;
  onUpdated: () => Promise<void>;
  onDeploy: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({
      files: [],
      base: [],
      head: null,
    }),
    [ready, setReady] = useState(false),
    [active, setActive] = useState("index.html"),
    [busy, setBusy] = useState(""),
    [search, setSearch] = useState(""),
    [mode, setMode] = useState("code"),
    [message, setMessage] = useState(
      p.last_commit_sha ? "Update website" : "Launch website",
    ),
    [auto, setAuto] = useState(false),
    [saved, setSaved] = useState(""),
    [deployNow, setDeployNow] = useState(true),
    [entry, setEntry] = useState("index.html");
  const latest = useRef({ draft, ready });
  latest.current = { draft, ready };
  useEffect(
    () => () => {
      if (latest.current.ready)
        void set("draft:" + p.id, latest.current.draft).catch(() =>
          onError(
            "Local draft storage failed. Export your files before leaving.",
          ),
        );
    },
    [p.id],
  );
  const files = draft.files,
    selected = files.find((f) => f.path === active),
    base = draft.base.find((f) => f.path === active);
  const changed = useMemo(() => {
    const all = new Set([
      ...files.map((f) => f.path),
      ...draft.base.map((f) => f.path),
    ]);
    return [...all].filter(
      (path) =>
        JSON.stringify(files.find((f) => f.path === path)) !==
        JSON.stringify(draft.base.find((f) => f.path === path)),
    );
  }, [draft]);
  const html = useMemo(() => previewHTML(files, entry), [files, entry]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  async function operation(fn: () => Promise<void>) {
    onError("");
    try {
      await fn();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function loadRemote() {
    setBusy("Reading GitHub file tree…");
    const tree = await api<{
      head: string | null;
      files: { path: string; sha: string; size: number }[];
    }>(`/projects/${p.id}/files`);
    if (tree.files.reduce((s, f) => s + f.size, 0) > LIMITS.total)
      throw new Error(
        "Repository exceeds the 8 MiB editor limit. Clone locally.",
      );
    const blocked = tree.files.filter(
      (f) => classifyPath(f.path).status !== "accepted",
    );
    if (blocked.length)
      throw new Error(
        "Repository contains protected files. Use a local Git editor so these files are not silently removed.",
      );
    const result: SourceFile[] = [];
    for (let i = 0; i < tree.files.length; i += 20) {
      setBusy(`Reading files ${i + 1}–${Math.min(i + 20, tree.files.length)}…`);
      const group = tree.files.slice(i, i + 20),
        blobs = await api<{ sha: string; content: string }[]>(
          `/projects/${p.id}/blobs/read`,
          "POST",
          { shas: group.map((f) => f.sha) },
        );
      for (const f of group) {
        const blob = blobs.find((b) => b.sha === f.sha)!;
        result.push(
          source(
            f.path,
            bytes({ path: f.path, content: blob.content, encoding: "base64" }),
          ),
        );
      }
    }
    if (result.length) validateFiles(result);
    const d = { files: result, base: structuredClone(result), head: tree.head };
    setDraft(d);
    await set("draft:" + p.id, d);
    setActive(result[0]?.path ?? "index.html");
    setBusy("");
  }
  useEffect(() => {
    let alive = true;
    void operation(async () => {
      const local = await get<Draft>("draft:" + p.id);
      if (!alive) return;
      if (local) {
        setDraft(local);
        setActive(local.files[0]?.path ?? "index.html");
      } else if (p.repository_id) await loadRemote();
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [p.id]);
  useEffect(() => {
    if (!ready) return;
    setSaved("Saving local draft…");
    const t = setTimeout(() => {
      void set("draft:" + p.id, draft)
        .then(() => setSaved("Draft saved on this device"))
        .catch(() =>
          onError("Local draft storage failed. Export a ZIP before leaving."),
        );
    }, 650);
    return () => clearTimeout(t);
  }, [draft, ready, p.id]);
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (changed.length) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    addEventListener("beforeunload", fn);
    return () => removeEventListener("beforeunload", fn);
  }, [changed.length]);
  async function push() {
    if (busy || !changed.length) return;
    setAuto(false);
    await operation(async () => {
      validateFiles(files);
      if (!message.trim()) throw new Error("Enter a commit message");
      setBusy("Preparing one atomic commit…");
      let tree: { path: string; sha: string }[] | undefined;
      if (draft.head) {
        tree = [];
        const pending = files.filter((f) => changed.includes(f.path));
        for (const f of files.filter((f) => !changed.includes(f.path)))
          tree.push({ path: f.path, sha: await blobId(f) });
        for (let i = 0; i < pending.length; i += 20) {
          setBusy(
            `Staging changed files ${i + 1}–${Math.min(i + 20, pending.length)}…`,
          );
          tree.push(
            ...(await api<{ path: string; sha: string }[]>(
              `/projects/${p.id}/blobs`,
              "POST",
              { files: pending.slice(i, i + 20) },
            )),
          );
        }
      }
      const result = await api<{ sha: string }>(
        `/projects/${p.id}/publish`,
        "POST",
        {
          ...(tree ? { tree } : { files }),
          expectedHead: draft.head,
          message,
          confirm: true,
        },
      );
      const next = {
        files: structuredClone(files),
        base: structuredClone(files),
        head: result.sha,
      };
      setDraft(next);
      await set("draft:" + p.id, next);
      await onUpdated();
      setBusy("");
      if (deployNow && !p.cloudflare_project_name) {
        setBusy("Creating Cloudflare Pages project…");
        await api(`/projects/${p.id}/deploy`, "POST", { confirm: true });
        await onUpdated();
        setBusy("");
        onDeploy();
      }
    });
  }
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (auto && draft.head && changed.length && !busy)
      timer.current = setTimeout(() => void push(), 120000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [auto, draft, busy, message]);
  function mutate(fn: () => SourceFile[]) {
    try {
      const next = fn();
      validateFiles(next);
      setDraft((d) => ({ ...d, files: next }));
    } catch (e) {
      onError((e as Error).message);
    }
  }
  function add(folder = false) {
    const path = prompt(
      folder
        ? "Folder path (a .gitkeep file preserves empty folders)"
        : "New file path, relative to the project root",
    );
    if (!path) return;
    mutate(() => [
      ...files,
      {
        path: safePath(folder ? path + "/.gitkeep" : path),
        encoding: "utf-8",
        content: "",
      },
    ]);
    setActive(folder ? path + "/.gitkeep" : path);
  }
  function rename(duplicate = false) {
    if (!selected) return;
    const path = prompt(
      duplicate ? "Path for the duplicate" : "New file path",
      selected.path,
    );
    if (!path || path === selected.path) return;
    mutate(() =>
      duplicate
        ? [...files, { ...selected, path: safePath(path) }]
        : files.map((f) =>
            f.path === active ? { ...f, path: safePath(path) } : f,
          ),
    );
    setActive(path);
  }
  function exportZip() {
    const data: Record<string, Uint8Array> = {};
    for (const f of files) data[f.path] = bytes(f);
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(zipSync(data))], { type: "application/zip" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = p.name + ".zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const filtered = useMemo(
    () =>
      files
        .filter(
          (f) =>
            !search ||
            f.path.toLowerCase().includes(search.toLowerCase()) ||
            (f.encoding === "utf-8" &&
              f.content.toLowerCase().includes(search.toLowerCase())),
        )
        .sort((a, b) => a.path.localeCompare(b.path)),
    [files, search],
  );
  return (
    <>
      <div className="page-heading editor-heading">
        <div>
          <div className="eyebrow">PROJECT EDITOR</div>
          <h1>
            {p.name}
            <Badge status={changed.length ? "unsaved-changes" : "saved"} />
          </h1>
          <p>
            {saved || "Local drafts stay in this browser"}
            {draft.head && ` · ${draft.head.slice(0, 7)}`}
          </p>
        </div>
        <div className="row">
          <Button onClick={exportZip}>
            <Download size={15} />
            Export ZIP
          </Button>
          <Button onClick={onDeploy}>
            Deployments
            <ChevronRight size={15} />
          </Button>
        </div>
      </div>
      {busy && (
        <div className="alert" role="status">
          {busy}
        </div>
      )}
      <div className="editor-layout">
        <aside className="file-sidebar">
          <div className="row">
            <strong>EXPLORER</strong>
            <span className="row">
              <button
                aria-label="Create file"
                onClick={() => add()}
                disabled={!!busy}
              >
                <FilePlus2 size={17} />
              </button>
              <button
                aria-label="Create folder"
                onClick={() => add(true)}
                disabled={!!busy}
              >
                <FolderPlus size={17} />
              </button>
            </span>
          </div>
          <label className="search">
            <Search size={15} />
            <input
              aria-label="Search across files"
              placeholder="Search files & code"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="file-tree">
            {filtered.map((f) => (
              <button
                key={f.path}
                className={active === f.path ? "file active" : "file"}
                onClick={() => setActive(f.path)}
                title={f.path}
              >
                <FileCode2 size={15} />
                <span>
                  {f.path.split("/").slice(0, -1).length > 0 && (
                    <small>{f.path.split("/").slice(0, -1).join("/")}/</small>
                  )}
                  {f.path.split("/").at(-1)}
                </span>
                {changed.includes(f.path) && <i />}
              </button>
            ))}
            {!filtered.length && <p className="muted">No matching files</p>}
          </div>
          <div className="file-count">
            <Folder size={13} />
            {files.length} files ·{" "}
            {(files.reduce((n, f) => n + bytes(f).length, 0) / 1024).toFixed(1)}{" "}
            KiB
          </div>
        </aside>
        <div className="code-pane">
          <div className="editor-toolbar">
            <span className="active-filename">
              <FileCode2 size={15} />
              {active}
            </span>
            <div className="row">
              <button
                aria-label="Rename file"
                disabled={!!busy}
                onClick={() => rename()}
              >
                <PenLine size={15} />
              </button>
              <button
                aria-label="Duplicate file"
                disabled={!!busy}
                onClick={() => rename(true)}
              >
                <Copy size={15} />
              </button>
              <button
                aria-label="Delete file"
                title="Delete file"
                disabled={!!busy}
                onClick={() => {
                  if (!selected) return;
                  if (files.length <= 1) {
                    onError("A project must contain at least one file.");
                    return;
                  }
                  if (confirm("Delete " + active + " from this draft?")) {
                    const remaining = files.filter((f) => f.path !== active);
                    mutate(() => remaining);
                    setActive(remaining[0]?.path ?? "");
                  }
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
          <div className="editor-tabs">
            <button
              className={mode === "code" ? "active" : ""}
              onClick={() => setMode("code")}
            >
              <Code2 size={15} />
              Code
            </button>
            <button
              className={mode === "diff" ? "active" : ""}
              onClick={() => setMode("diff")}
            >
              <GitCompareArrows size={15} />
              Changes ({changed.length})
            </button>
            <button
              className={mode === "preview" ? "active" : ""}
              onClick={() => setMode("preview")}
            >
              <Eye size={15} />
              Preview
            </button>
          </div>
          <div className="editor-body">
            {mode === "preview" ? (
              p.framework_type !== "static" ? (
                <div className="empty">
                  <CloudMessage />
                </div>
              ) : (
                <>
                  <label className="preview-entry">
                    Entry file{" "}
                    <select
                      value={entry}
                      onChange={(e) => setEntry(e.target.value)}
                    >
                      {files
                        .filter((f) => /\.html?$/.test(f.path))
                        .map((f) => (
                          <option key={f.path}>{f.path}</option>
                        ))}
                    </select>
                    <small>
                      Isolated preview · external requests and navigation
                      disabled
                    </small>
                  </label>
                  <Preview html={html} />
                </>
              )
            ) : mode === "diff" ? (
              <>
                <div className="changed-list">
                  {changed.map((path) => (
                    <button key={path} onClick={() => setActive(path)}>
                      {!files.some((f) => f.path === path)
                        ? "−"
                        : !draft.base.some((f) => f.path === path)
                          ? "+"
                          : "~"}{" "}
                      {path}
                    </button>
                  ))}
                  {!changed.length && <span>No unpushed changes</span>}
                </div>
                {selected?.encoding === "base64" ||
                base?.encoding === "base64" ? (
                  <div className="empty">
                    Binary asset changed. Export the ZIP to inspect its bytes.
                  </div>
                ) : (
                  <DiffView
                    language={language(active)}
                    original={base?.content ?? ""}
                    modified={selected?.content ?? ""}
                  />
                )}
              </>
            ) : selected ? (
              selected.encoding === "base64" ? (
                <div className="empty">
                  <FileCode2 size={32} />
                  <h3>Binary asset</h3>
                  <p>{selected.path} is preserved byte for byte.</p>
                  <Button onClick={exportZip}>Export to inspect</Button>
                </div>
              ) : (
                <Monaco
                  height="500px"
                  path={selected.path}
                  language={language(selected.path)}
                  theme="vs-dark"
                  value={selected.content}
                  onChange={(value) =>
                    setDraft((d) => ({
                      ...d,
                      files: d.files.map((f) =>
                        f.path === active ? { ...f, content: value ?? "" } : f,
                      ),
                    }))
                  }
                  options={{
                    readOnly: !!busy,
                    fontSize: 13,
                    minimap: { enabled: false },
                    padding: { top: 18 },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                    wordWrap: "on",
                  }}
                />
              )
            ) : (
              <div className="empty">Select a file from the explorer.</div>
            )}
          </div>
        </div>
      </div>
      <div className="panel publish-panel">
        <div>
          <h3>{draft.head ? "Save & push" : "Publish to GitHub"}</h3>
          <p>
            One commit for all your changes. Review the diff before publishing.
          </p>
          <Field label="Commit message">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={500}
            />
          </Field>
          <div className="row">
            <Button onClick={() => setMode("diff")}>
              <GitCompareArrows size={15} />
              Review diff
            </Button>
            <Button
              primary
              disabled={!!busy || !ready || !changed.length}
              onClick={() => {
                setMode("diff");
                if (
                  confirm(
                    `Publish ${changed.length} changed files to ${p.repository_name} (${p.private ? "private" : "public"})?${p.cloudflare_project_name ? " Cloudflare will build this commit." : ""}`,
                  )
                )
                  void push();
              }}
            >
              {draft.head ? <Save size={15} /> : <Upload size={15} />}{" "}
              {draft.head ? "Save & Push" : "Publish to GitHub"}
            </Button>
          </div>
        </div>
        <div>
          <label className="check">
            <input
              type="checkbox"
              checked={deployNow}
              onChange={(e) => setDeployNow(e.target.checked)}
            />
            Deploy immediately after first publish
          </label>
          {draft.head && (
            <label className="check">
              <input
                type="checkbox"
                checked={auto}
                onChange={(e) => {
                  if (
                    !e.target.checked ||
                    confirm(
                      "Enable one automatic push after 2 minutes idle? This sends changes to GitHub and can trigger a Cloudflare build.",
                    )
                  )
                    setAuto(e.target.checked);
                }}
              />
              Auto-push once after 2 minutes idle
            </label>
          )}
          <p className="muted">
            Auto-push switches off after each attempt. No commits on every
            keypress.
          </p>
          {p.repository_id && (
            <Button
              disabled={!!busy}
              onClick={() => {
                if (
                  confirm(
                    "Replace this local draft with GitHub? Export a ZIP first if you have unpushed changes.",
                  )
                )
                  void operation(loadRemote);
              }}
            >
              Reload from GitHub
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
function CloudMessage() {
  return (
    <>
      <h3>This project needs a build</h3>
      <p>
        Framework source cannot run as a static local preview. Push your changes
        and use the Cloudflare preview URL after a successful build.
      </p>
    </>
  );
}
