import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { MONO, hintStyle, primaryButton, smallButton } from "./DialogFrame.tsx";
import { ApiError, getWorkspace, listFolders } from "../local/api.ts";
import type { FolderListing } from "../local/api.ts";
import { lastPickerPath, recentRepos, rememberPickerPath } from "../local/recent.ts";

// Picks the repo to open, by walking folders under the server's workspace
// root. The server only ever hands back folder names and two flags (a git
// repo, a repo that already has .ordo/), never a path outside the root, so the
// breadcrumb starts at the root's label ("~") rather than at /.
//
// A click on a folder goes into it; its Open button, or "Open this folder" for
// the one being shown, picks it. The repos opened lately sit on top.

const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 6px 0 2px",
  borderRadius: 7,
  minHeight: 32,
};

const folderButton: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flex: 1,
  minWidth: 0,
  height: 30,
  padding: "0 8px",
  border: "none",
  borderRadius: 6,
  background: "transparent",
  color: "var(--ui-ink)",
  font: "inherit",
  fontSize: 13,
  textAlign: "left",
  cursor: "pointer",
};

const badge = (tone: "accent" | "plain"): CSSProperties => ({
  padding: "1px 6px",
  borderRadius: 5,
  fontFamily: MONO,
  fontSize: 10.5,
  lineHeight: 1.5,
  border: `1px solid ${tone === "accent" ? "var(--ui-accent)" : "var(--ui-border-strong)"}`,
  color: tone === "accent" ? "var(--ui-accent-ink)" : "var(--ui-muted)",
  background: tone === "accent" ? "var(--ui-accent-soft)" : "transparent",
});

const join = (path: string, name: string) => (path ? `${path}/${name}` : name);

/** A readable sentence for a listing that failed. */
function explain(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403)
      return "Ordo can't read this folder. On macOS, the terminal (or Docker) running Ordo may need access to it under System Settings › Privacy & Security › Files and Folders.";
    if (e.status === 404) return "This folder doesn't exist any more.";
    return e.message;
  }
  return "Couldn't reach the Ordo server.";
}

export default function RepoBrowser({ onOpen }: { onOpen: (repo: string) => void }) {
  const [label, setLabel] = useState("~");
  const [path, setPath] = useState("");
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [recent] = useState(recentRepos);
  const seq = useRef(0);

  // A listing that comes back after the person has moved on is dropped.
  const go = useCallback(async (to: string, fallBackToRoot = false) => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const next = await listFolders(to);
      if (mine !== seq.current) return;
      setListing(next);
      setPath(next.path);
      rememberPickerPath(next.path);
    } catch (e) {
      if (mine !== seq.current) return;
      // The folder remembered from last time may be gone: start at the root.
      if (fallBackToRoot && to !== "") return void go("");
      setListing(null);
      setPath(to);
      setError(explain(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    getWorkspace()
      .then((w) => setLabel(w.label))
      .catch(() => {});
    void go(lastPickerPath(), true);
  }, [go]);

  const segments = path ? path.split("/") : [];

  return (
    <div style={{ fontFamily: "system-ui, sans-serif" }}>
      {recent.length > 0 && (
        <section style={{ marginBottom: 20 }}>
          <h3 style={sectionTitle}>Recent</h3>
          <ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 6, margin: 0, padding: 0, listStyle: "none" }}>
            {recent.map((repo) => (
              <li key={repo} style={{ display: "flex", minWidth: 0 }}>
                <RecentRepo repo={repo} label={label} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 style={sectionTitle}>Browse</h3>
        <nav aria-label="Folder" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2, marginBottom: 8, fontSize: 13 }}>
          <Crumb onClick={() => void go("")} current={!segments.length}>
            {label}
          </Crumb>
          {segments.map((seg, i) => (
            <span key={i} style={{ display: "contents" }}>
              <span style={{ color: "var(--ui-faint)" }}>/</span>
              <Crumb onClick={() => void go(segments.slice(0, i + 1).join("/"))} current={i === segments.length - 1}>
                {seg}
              </Crumb>
            </span>
          ))}
        </nav>

        <div
          aria-busy={loading}
          style={{
            height: 300,
            overflow: "auto",
            padding: 4,
            borderRadius: 10,
            border: "1px solid var(--ui-border)",
            background: "var(--ui-surface-sunken)",
            opacity: loading ? 0.6 : 1,
            transition: "opacity .1s",
          }}
        >
          {error ? (
            <p role="alert" style={{ margin: 12, fontSize: 13, lineHeight: 1.5, color: "var(--ui-danger)" }}>
              {error}
            </p>
          ) : listing && listing.folders.length === 0 ? (
            <p style={{ margin: 12, fontSize: 13, color: "var(--ui-muted)" }}>No folders here.</p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {listing?.folders.map((f) => (
                <li key={f.name} style={row} className="ordo-picker-row">
                  <button type="button" onClick={() => void go(join(path, f.name))} style={folderButton} title={`Go into ${f.name}`}>
                    <FolderIcon size={15} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                    {f.ordo && <span style={badge("accent")}>.ordo</span>}
                    {f.git && <span style={badge("plain")}>git</span>}
                  </button>
                  <button type="button" onClick={() => onOpen(join(path, f.name))} style={smallButton} title={`Open ${join(path, f.name)}`}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {listing?.truncated && (
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--ui-muted)" }}>
            Showing the first {listing.folders.length.toLocaleString("en")} folders.
          </p>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
          <span style={hintStyle}>Click a folder to go in.</span>
          <button
            type="button"
            disabled={Boolean(error) || loading}
            onClick={() => onOpen(path)}
            title={`Open ${path || label} as the project`}
            style={primaryButton(Boolean(error) || loading)}
          >
            Open this folder
          </button>
        </div>
      </section>
    </div>
  );
}

/** A repo opened lately: its own name, and the folders it sits in under the root. */
function RecentRepo({ repo, label, onOpen }: { repo: string; label: string; onOpen: (repo: string) => void }) {
  const parts = repo.split("/").filter(Boolean);
  const name = parts.at(-1) ?? label;
  const parent = [label, ...parts.slice(0, -1)].join("/");
  return (
    <button
      type="button"
      onClick={() => onOpen(repo)}
      title={`Open ${repo}`}
      className="ordo-picker-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flex: 1,
        minWidth: 0,
        padding: "8px 10px",
        borderRadius: 8,
        border: "1px solid var(--ui-border)",
        background: "var(--ui-surface)",
        font: "inherit",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span style={{ color: "var(--ui-accent-ink)", display: "inline-flex" }}>
        <FolderIcon size={16} />
      </span>
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ui-ink)", ...ellipsis }}>{name}</span>
        {repo && <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--ui-faint)", ...ellipsis }}>{parent}</span>}
      </span>
    </button>
  );
}

const ellipsis: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

const sectionTitle: CSSProperties = {
  margin: "0 0 8px",
  fontSize: 11.5,
  fontWeight: 600,
  letterSpacing: 0.3,
  textTransform: "uppercase",
  color: "var(--ui-faint)",
};

function Crumb({ children, onClick, current }: { children: string; onClick: () => void; current: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? "location" : undefined}
      style={{
        padding: "2px 5px",
        border: "none",
        borderRadius: 5,
        background: "transparent",
        font: "inherit",
        fontFamily: MONO,
        fontSize: 12.5,
        fontWeight: current ? 600 : 400,
        color: current ? "var(--ui-ink)" : "var(--ui-accent-ink)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

export function FolderIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden style={{ flex: "0 0 auto" }}>
      <path
        d="M1.75 4.75a1.5 1.5 0 0 1 1.5-1.5h3.4l1.6 1.75h6.5a1.5 1.5 0 0 1 1.5 1.5v6.75a1.5 1.5 0 0 1-1.5 1.5H3.25a1.5 1.5 0 0 1-1.5-1.5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
