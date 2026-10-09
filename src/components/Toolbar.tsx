import type { CSSProperties, RefObject } from "react";
import {
  STROKE_SWATCHES,
  STROKE_WEIGHTS,
  LINE_TYPES,
  inkOf,
  lineTypeOf,
} from "../edgeStyle.ts";
import type { EdgeStyle } from "../edgeStyle.ts";
import { MARKERS, MARKER_KEYS } from "../edges/index.ts";
import { HISTORY_LIMIT } from "../history.ts";
import { FileIcon, MONO } from "./DialogFrame.tsx";
import { FolderIcon } from "./RepoPickerDialog.tsx";
import { UnsyncedDot } from "./TabBar.tsx";
import { useCanvasTheme } from "../nodes/chrome.tsx";
import type { Scheme } from "../colorScheme.ts";

const MOD = navigator.platform.startsWith("Mac") ? "\u2318" : "Ctrl";

// Line appearance. Edits land on the current edge selection when there is one,
// and otherwise become the default for the next edge drawn — the behaviour
// every drawing tool has, and the reason the strip reports which it will do.

const groupStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 4 };

const divider = (
  <div
    style={{ width: 1, height: 22, background: "var(--ui-border)", margin: "0 6px" }}
  />
);

const selectStyle: CSSProperties = {
  height: 28,
  borderRadius: 6,
  border: "1px solid var(--ui-border-strong)",
  background: "var(--ui-surface)",
  font: "inherit",
  fontSize: 12.5,
  color: "var(--ui-ink)",
  padding: "0 6px",
  cursor: "pointer",
  maxWidth: 148,
};

// The import and export buttons at the end of the strip.
const importButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  height: 28,
  padding: "0 11px",
  borderRadius: 6,
  border: "1px solid var(--ui-border-strong)",
  background: "var(--ui-surface-sunken)",
  font: "inherit",
  fontSize: 12.5,
  color: "var(--ui-ink-2)",
  cursor: "pointer",
};

const MARKER_GROUPS = [
  ["flow", "Flowchart"],
  ["uml", "UML"],
  ["er", "ER cardinality"],
];

function MarkerSelect({
  id,
  title,
  value,
  onChange,
}: {
  id: string;
  title: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ ...groupStyle, color: "var(--ui-muted)", fontSize: 12.5 }}>
      {title}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={selectStyle}
      >
        <option value="none">None</option>
        {MARKER_GROUPS.map(([g, gl]) => (
          <optgroup key={g} label={gl}>
            {MARKER_KEYS.filter(
              (k) => k !== "none" && MARKERS[k].group === g,
            ).map((k) => (
              <option key={k} value={k}>
                {MARKERS[k].label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

// The selection chip doubles as the only place the multi-select, clipboard and
// undo chords are written down — shortcuts nobody can see are shortcuts nobody
// uses.
const SHORTCUTS = [
  "Shift-drag: lasso",
  `${MOD}-click: add to selection`,
  `${MOD}+A: select all`,
  `${MOD}+C / ${MOD}+X / ${MOD}+V: copy, cut, paste`,
  `${MOD}+D: duplicate`,
  `${MOD}+Z / ${MOD}+Shift+Z: undo, redo (last ${HISTORY_LIMIT} changes)`,
  `${MOD}+S: sync (in a repo)`,
].join("\n");

/** Local mode's corner of the strip: where you are, whether it is saved, and Sync. */
export type LocalBar = {
  crumb: string[]; // the root's label, then the repo's folders
  tab: string | null;
  status: "loading" | "up-to-date" | "unsynced" | "syncing" | "empty" | "invalid" | "error";
  canSync: boolean;
  onSync: () => void;
  onLeave: () => void; // back to free-form
};

const STATUS_WORDS: Record<LocalBar["status"], string> = {
  loading: "Opening…",
  "up-to-date": "Up to date",
  unsynced: "Unsynced",
  syncing: "Syncing…",
  empty: "No diagrams yet",
  invalid: "File has errors",
  error: "Can't open",
};

function LocalSegment({ local }: { local: LocalBar }) {
  const where = local.crumb.join(" / ");
  return (
    <>
      <div style={{ ...groupStyle, gap: 6, minWidth: 0 }} title={local.tab ? `${where} · ${local.tab}` : where}>
        <span style={{ color: "var(--ui-muted)", display: "inline-flex" }}>
          <FolderIcon size={14} />
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 12,
            color: "var(--ui-ink-2)",
            maxWidth: 260,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            direction: "rtl", // a long path keeps its end, the repo's own name, in view
          }}
        >
          {"\u200e" + where + "\u200e"}
        </span>
        <button
          type="button"
          onClick={local.onLeave}
          title="Close the repo and draw free-form"
          aria-label="Close the repo"
          style={{ ...importButton, height: 22, width: 22, padding: 0, justifyContent: "center", background: "transparent", border: "none" }}
        >
          <svg width="11" height="11" viewBox="0 0 15 15" fill="none">
            <path d="M3.5 3.5l8 8M11.5 3.5l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <span
        role="status"
        style={{
          ...groupStyle,
          gap: 6,
          marginLeft: 6,
          fontSize: 12.5,
          whiteSpace: "nowrap",
          color: local.status === "unsynced" || local.status === "invalid" ? "var(--ui-warn)" : "var(--ui-faint)",
        }}
      >
        {local.status === "unsynced" && <UnsyncedDot />}
        {STATUS_WORDS[local.status]}
      </span>
      <button
        type="button"
        onClick={local.onSync}
        disabled={!local.canSync}
        title={`Sync with ${local.tab ?? "the file"}: write the canvas, or load the file's changes (${MOD}+S)`}
        style={{
          ...importButton,
          marginLeft: 8,
          cursor: local.canSync ? "pointer" : "not-allowed",
          opacity: local.canSync ? 1 : 0.55,
          ...(local.status === "unsynced"
            ? { border: "1px solid var(--ui-accent)", background: "var(--ui-accent-soft)", color: "var(--ui-accent-ink)" }
            : {}),
        }}
      >
        <svg width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden>
          <path
            d="M14.5 7.25A5.75 5.75 0 0 0 4.1 5.6M3.5 10.75a5.75 5.75 0 0 0 10.4 1.65"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path d="M3.75 2.75v3h3M14.25 15.25v-3h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Sync
      </button>
      {divider}
    </>
  );
}

export default function Toolbar({
  value,
  onChange,
  selectedCount,
  selectedNodeCount = 0,
  onImport,
  onImportYaml,
  onViewYaml,
  importYamlRef,
  viewYamlRef,
  scheme,
  onToggleScheme,
  onOpenRepo,
  local,
}: {
  value: EdgeStyle;
  onChange: (patch: Partial<EdgeStyle>) => void;
  selectedCount: number;
  selectedNodeCount?: number;
  onImport: () => void;
  onImportYaml: () => void;
  onViewYaml: () => void;
  // The Ordo dialogs hand focus back to the button that opened them.
  importYamlRef?: RefObject<HTMLButtonElement | null>;
  viewYamlRef?: RefObject<HTMLButtonElement | null>;
  scheme: Scheme;
  onToggleScheme: () => void;
  onOpenRepo: () => void;
  local?: LocalBar; // present in local mode
}) {
  const theme = useCanvasTheme();
  const activeType = lineTypeOf(value.dash);
  const picked = [
    selectedNodeCount &&
      `${selectedNodeCount} node${selectedNodeCount > 1 ? "s" : ""}`,
    selectedCount && `${selectedCount} line${selectedCount > 1 ? "s" : ""}`,
  ].filter(Boolean);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: "14px 12px 8px",
        borderBottom: "1px solid var(--ui-border)",
        background: "var(--ui-surface)",
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        flexWrap: "wrap",
      }}
    >
      {local && <LocalSegment local={local} />}

      <span style={{ color: "var(--ui-muted)", marginRight: 8 }}>Line</span>

      <div style={groupStyle}>
        {STROKE_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            title={inkOf(c, theme) === c ? c : `Ink (${c}) — follows the theme`}
            aria-label={`Stroke ${c}`}
            aria-pressed={value.stroke === c}
            onClick={() => onChange({ stroke: c })}
            style={{
              width: 22,
              height: 22,
              borderRadius: 5,
              background: inkOf(c, theme),
              cursor: "pointer",
              border:
                value.stroke === c ? "2px solid var(--ui-accent)" : "1px solid var(--ui-border-strong)",
              boxShadow: value.stroke === c ? "0 0 0 2px var(--ui-accent-soft)" : "none",
            }}
          />
        ))}
        <input
          id="ordo-stroke-color"
          type="color"
          aria-label="Custom stroke colour"
          value={value.stroke}
          onChange={(e) => onChange({ stroke: e.target.value })}
          style={{
            width: 26,
            height: 24,
            padding: 0,
            border: "1px solid var(--ui-border-strong)",
            borderRadius: 5,
            background: "var(--ui-surface)",
            cursor: "pointer",
          }}
        />
      </div>

      {divider}

      <label style={{ ...groupStyle, color: "var(--ui-muted)" }}>
        Weight
        <select
          id="ordo-stroke-width"
          value={value.strokeWidth}
          onChange={(e) => onChange({ strokeWidth: Number(e.target.value) })}
          style={selectStyle}
        >
          {STROKE_WEIGHTS.map((w) => (
            <option key={w} value={w}>
              {w}px
            </option>
          ))}
        </select>
      </label>

      {divider}

      <div style={groupStyle}>
        {LINE_TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            title={t.label}
            aria-label={t.label}
            aria-pressed={activeType === t.key}
            onClick={() => onChange({ dash: t.dash })}
            style={{
              height: 28,
              padding: "0 8px",
              display: "grid",
              placeItems: "center",
              borderRadius: 6,
              cursor: "pointer",
              border:
                activeType === t.key
                  ? "1px solid var(--ui-accent)"
                  : "1px solid var(--ui-border-strong)",
              background: activeType === t.key ? "var(--ui-accent-soft)" : "var(--ui-surface)",
            }}
          >
            <svg width="30" height="10" viewBox="0 0 30 10">
              <path
                d="M1 5h28"
                stroke={inkOf(value.stroke, theme)}
                strokeWidth={value.strokeWidth}
                strokeLinecap="round"
                {...(t.dash ? { strokeDasharray: t.dash } : {})}
              />
            </svg>
          </button>
        ))}
      </div>

      {divider}

      <MarkerSelect
        id="ordo-marker-start"
        title="Start"
        value={value.markerStart}
        onChange={(markerStart) => onChange({ markerStart })}
      />
      <MarkerSelect
        id="ordo-marker-end"
        title="End"
        value={value.markerEnd}
        onChange={(markerEnd) => onChange({ markerEnd })}
      />

      <span
        title={SHORTCUTS}
        style={{
          marginLeft: "auto",
          fontSize: 12.5,
          color: picked.length ? "var(--ui-accent-strong)" : "var(--ui-faint)",
          cursor: "help",
          whiteSpace: "nowrap",
        }}
      >
        {picked.length ? `${picked.join(" · ")} selected` : "Nothing selected"}
      </span>

      <button
        type="button"
        onClick={onImport}
        title="Import a Mermaid diagram"
        style={{ ...importButton, marginLeft: 10 }}
      >
        <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
          <rect
            x="1.75"
            y="2.25"
            width="6"
            height="4"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <rect
            x="10.25"
            y="11.75"
            width="6"
            height="4"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path
            d="M4.75 6.25v5a2.5 2.5 0 0 0 2.5 2.5h3"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        Import Mermaid
      </button>

      <button
        ref={importYamlRef}
        type="button"
        onClick={onImportYaml}
        title="Open a diagram from its .yaml file"
        style={{ ...importButton, marginLeft: 6 }}
      >
        <FileIcon size={14} inside="in" />
        Import  Ordo YAML
      </button>

      <button
        ref={viewYamlRef}
        type="button"
        onClick={onViewYaml}
        title="See the canvas as Ordo YAML, and copy it"
        style={{ ...importButton, marginLeft: 6 }}
      >
        <FileIcon size={14} inside="code" />
        View Ordo YAML
      </button>

      <button
        type="button"
        onClick={onOpenRepo}
        title={local ? "Open another repo" : "Open a repo, and edit the diagrams in its .ordo/ folder"}
        style={{ ...importButton, marginLeft: 6 }}
      >
        <FolderIcon size={14} />
        Open repo
      </button>

      <button
        type="button"
        onClick={onToggleScheme}
        title={scheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        aria-label={scheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        style={{ ...importButton, marginLeft: 6, padding: 0, width: 28, justifyContent: "center" }}
      >
        {scheme === "dark" ? (
          // sun: what the click switches to
          <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="3.25" stroke="currentColor" strokeWidth="1.4" />
            <path
              d="M9 1.75v1.5M9 14.75v1.5M1.75 9h1.5M14.75 9h1.5M3.87 3.87l1.06 1.06M13.07 13.07l1.06 1.06M3.87 14.13l1.06-1.06M13.07 4.93l1.06-1.06"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          // moon
          <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
            <path
              d="M15.25 10.6A6.5 6.5 0 0 1 7.4 2.75a6.5 6.5 0 1 0 7.85 7.85z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
