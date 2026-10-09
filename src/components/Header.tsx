import type { CSSProperties, ReactNode, RefObject } from "react";
import { FileIcon, MONO } from "./DialogFrame.tsx";
import { FolderIcon } from "./RepoBrowser.tsx";
import { UnsyncedDot } from "./TabBar.tsx";
import Popover, { MenuItem } from "./Popover.tsx";
import { HISTORY_LIMIT } from "../history.ts";
import { AUTO_SYNC_MS } from "../local/useLocalMode.ts";
import type { Scheme } from "../colorScheme.ts";

// The one bar across the top of every page. Left, where you are: Ordo, then
// the open project with a way back to the projects page. Right, what you can
// do there: in the editor, the diagram's sync state and Sync, getting a
// diagram in or out, and the shortcuts; everywhere, the colour scheme. Line
// styling lives in the sidebar's Edges panel, next to the routes it goes with.

const MOD = navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl";

export const HEADER_HEIGHT = 48;

/** A borderless button: the header's secondary actions. Hover is ui.css's. */
const ghostButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  height: 30,
  padding: "0 10px",
  borderRadius: 7,
  border: "none",
  background: "transparent",
  font: "inherit",
  fontSize: 13,
  color: "var(--ui-ink-2)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const iconButton: CSSProperties = { ...ghostButton, width: 30, padding: 0, justifyContent: "center", color: "var(--ui-muted)" };

const divider = <span aria-hidden style={{ width: 1, height: 20, background: "var(--ui-border)", margin: "0 6px" }} />;

/** The open diagram's state and its Sync button. */
export type SyncBar = {
  tab: string | null;
  status: "loading" | "up-to-date" | "unsynced" | "syncing" | "invalid";
  canSync: boolean;
  onSync: () => void;
};

const STATUS_WORDS: Record<SyncBar["status"], string> = {
  loading: "Opening…",
  "up-to-date": "Up to date",
  unsynced: "Unsynced",
  syncing: "Syncing…",
  invalid: "File has errors",
};

/** Getting a diagram in or out of the canvas. The Ordo dialogs hand focus back to the button that opened them. */
export type FileActions = {
  onImportMermaid: () => void;
  onImportYaml: () => void;
  onViewYaml: () => void;
  importRef: RefObject<HTMLButtonElement | null>;
  viewRef: RefObject<HTMLButtonElement | null>;
};

export type Project = {
  path: string[]; // the workspace root's label, then the repo's folders
  onLeave: () => void; // back to the projects page
};

// Written down here and nowhere else: shortcuts nobody can see are shortcuts
// nobody uses.
const SHORTCUTS: [keys: string, what: string][] = [
  ["Shift-drag", "Lasso select"],
  [`${MOD}-click`, "Add to the selection"],
  [`${MOD} A`, "Select all"],
  [`${MOD} C · X · V`, "Copy, cut, paste"],
  [`${MOD} D`, "Duplicate"],
  [`${MOD} Z`, "Undo"],
  [`${MOD} ⇧ Z`, `Redo (last ${HISTORY_LIMIT} changes)`],
  ["Delete", "Delete the selection"],
  [`${MOD} S`, "Sync with the file"],
];

export default function Header({
  scheme,
  onToggleScheme,
  project,
  sync,
  file,
}: {
  scheme: Scheme;
  onToggleScheme: () => void;
  project?: Project; // a repo is open
  sync?: SyncBar; // the editor is showing
  file?: FileActions; // the editor is showing
}) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        height: HEADER_HEIGHT,
        flex: "0 0 auto",
        padding: "0 12px 0 14px",
        borderBottom: "1px solid var(--ui-border)",
        background: "var(--ui-surface)",
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        minWidth: 0,
      }}
    >
      <Brand />
      {project && <ProjectCrumb project={project} />}

      <span style={{ flex: 1 }} />

      {sync && <SyncSegment sync={sync} />}
      {file && (
        <>
          {sync && divider}
          <Popover
            label="Import a diagram"
            buttonRef={file.importRef}
            buttonStyle={ghostButton}
            buttonClassName="ordo-ghost"
            width={272}
            button={
              <>
                <FileIcon size={15} inside="in" />
                Import
                <Caret />
              </>
            }
          >
            {(close) => (
              <>
                <MenuItem
                  icon={<MermaidIcon />}
                  title="Mermaid diagram…"
                  hint="Paste or drop a flowchart or sequence diagram. It lands beside what's here."
                  onSelect={() => {
                    close();
                    file.onImportMermaid();
                  }}
                />
                <MenuItem
                  icon={<FileIcon size={15} inside="in" />}
                  title="Ordo YAML file…"
                  hint="Open a .yaml file. It replaces the canvas; Sync writes it to this tab."
                  onSelect={() => {
                    close();
                    file.onImportYaml();
                  }}
                />
              </>
            )}
          </Popover>
          <button
            ref={file.viewRef}
            type="button"
            onClick={file.onViewYaml}
            title="See the canvas as Ordo YAML, and copy or download it"
            className="ordo-ghost"
            style={ghostButton}
          >
            <FileIcon size={15} inside="code" />
            View YAML
          </button>
          {divider}
          <Popover
            label="Keyboard shortcuts"
            role="dialog"
            buttonStyle={iconButton}
            buttonClassName="ordo-ghost"
            width={280}
            button={<KeyboardIcon />}
          >
            {() => <ShortcutList />}
          </Popover>
        </>
      )}

      <button
        type="button"
        onClick={onToggleScheme}
        title={scheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        aria-label={scheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        className="ordo-ghost"
        style={iconButton}
      >
        {scheme === "dark" ? <SunIcon /> : <MoonIcon />}
      </button>
    </header>
  );
}

function Brand() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
      <OrdoMark />
      <span style={{ fontSize: 14, fontWeight: 650, color: "var(--ui-ink)", letterSpacing: -0.1 }}>Ordo</span>
    </span>
  );
}

const crumbSlash = <span style={{ color: "var(--ui-faint)", margin: "0 2px" }}>/</span>;

function ProjectCrumb({ project }: { project: Project }) {
  const [root, ...folders] = project.path;
  const name = folders.at(-1) ?? root;
  const full = [root, ...folders].join("/");
  return (
    <nav aria-label="Project" style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0, marginLeft: 10 }}>
      {crumbSlash}
      <button
        type="button"
        onClick={project.onLeave}
        title="Close this project and pick another"
        className="ordo-ghost"
        style={{ ...ghostButton, padding: "0 7px", color: "var(--ui-muted)" }}
      >
        Projects
      </button>
      {crumbSlash}
      <span
        title={full}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "0 7px",
          minWidth: 0,
          color: "var(--ui-ink)",
          fontWeight: 600,
        }}
      >
        <span style={{ color: "var(--ui-muted)", display: "inline-flex" }}>
          <FolderIcon size={15} />
        </span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      </span>
    </nav>
  );
}

function SyncSegment({ sync }: { sync: SyncBar }) {
  const loud = sync.status === "unsynced";
  return (
    <>
      <span
        role="status"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          marginRight: 8,
          fontSize: 12.5,
          whiteSpace: "nowrap",
          color: loud || sync.status === "invalid" ? "var(--ui-warn)" : "var(--ui-faint)",
        }}
      >
        {loud && <UnsyncedDot />}
        {STATUS_WORDS[sync.status]}
      </span>
      <button
        type="button"
        onClick={sync.onSync}
        disabled={!sync.canSync}
        title={`Sync with ${sync.tab ?? "the file"}: write the canvas, or load the file's changes (${MOD}+S). Also runs on its own every ${AUTO_SYNC_MS / 1000} seconds.`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          height: 30,
          padding: "0 12px",
          borderRadius: 7,
          font: "inherit",
          fontSize: 13,
          fontWeight: loud ? 600 : 500,
          whiteSpace: "nowrap",
          cursor: sync.canSync ? "pointer" : "not-allowed",
          opacity: sync.canSync ? 1 : 0.55,
          ...(loud
            ? { border: "1px solid var(--ui-accent)", background: "var(--ui-accent-soft)", color: "var(--ui-accent-ink)" }
            : { border: "1px solid var(--ui-border-strong)", background: "var(--ui-surface)", color: "var(--ui-ink-2)" }),
        }}
      >
        <SyncIcon />
        Sync
      </button>
    </>
  );
}

function ShortcutList() {
  return (
    <div style={{ padding: "4px 6px 2px" }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", color: "var(--ui-faint)", margin: "2px 0 8px" }}>
        Keyboard shortcuts
      </div>
      <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "7px 12px", margin: 0, fontSize: 12.5 }}>
        {SHORTCUTS.map(([keys, what]) => (
          <div key={keys} style={{ display: "contents" }}>
            <dt style={{ color: "var(--ui-ink-2)" }}>{what}</dt>
            <dd style={{ margin: 0, justifySelf: "end" }}>
              <kbd
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  padding: "1px 6px",
                  borderRadius: 5,
                  border: "1px solid var(--ui-border-strong)",
                  background: "var(--ui-surface-sunken)",
                  color: "var(--ui-ink-3)",
                  whiteSpace: "nowrap",
                }}
              >
                {keys}
              </kbd>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// --- icons ------------------------------------------------------------------

const Icon = ({ children, size = 15 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden style={{ flex: "0 0 auto" }}>
    {children}
  </svg>
);

/** The logo: an edge with a node riding it. Same geometry as public/favicon.svg. */
const OrdoMark = () => (
  <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden>
    <path d="M6 50 C30 50 34 14 58 14" fill="none" stroke="var(--ui-ink)" strokeWidth="6" strokeLinecap="round" />
    <circle cx="32" cy="32" r="10" fill="var(--ui-accent)" />
  </svg>
);

/** Two boxes and the line between them: Mermaid import's icon. */
function MermaidIcon() {
  return (
    <Icon>
      <rect x="1.75" y="2.25" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="10.25" y="11.75" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.75 6.25v5a2.5 2.5 0 0 0 2.5 2.5h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </Icon>
  );
}

const Caret = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden style={{ color: "var(--ui-faint)" }}>
    <path d="M2.5 3.75 5 6.25l2.5-2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const SyncIcon = () => (
  <Icon size={14}>
    <path d="M14.5 7.25A5.75 5.75 0 0 0 4.1 5.6M3.5 10.75a5.75 5.75 0 0 0 10.4 1.65" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M3.75 2.75v3h3M14.25 15.25v-3h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </Icon>
);

const KeyboardIcon = () => (
  <Icon size={16}>
    <rect x="1.75" y="4.25" width="14.5" height="9.5" rx="1.75" stroke="currentColor" strokeWidth="1.4" />
    <path d="M4.75 7.25h.01M7.25 7.25h.01M9.75 7.25h.01M12.25 7.25h.01M5.75 10.75h6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </Icon>
);

// The icon is what the click switches to.
const SunIcon = () => (
  <Icon>
    <circle cx="9" cy="9" r="3.25" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M9 1.75v1.5M9 14.75v1.5M1.75 9h1.5M14.75 9h1.5M3.87 3.87l1.06 1.06M13.07 13.07l1.06 1.06M3.87 14.13l1.06-1.06M13.07 4.93l1.06-1.06"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </Icon>
);

const MoonIcon = () => (
  <Icon>
    <path d="M15.25 10.6A6.5 6.5 0 0 1 7.4 2.75a6.5 6.5 0 1 0 7.85 7.85z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </Icon>
);
