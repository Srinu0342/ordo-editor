import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { checkDiagramName } from "../local/names.ts";
import { primaryButton } from "./DialogFrame.tsx";

// A repo's diagrams as footer tabs, Lucid-style: one per .ordo/<name>/ folder,
// A–Z, the open one raised. `+` turns into a name field that checks the name
// as you type, by the same rules the server enforces, and shows the server's
// own sentence if it still says no (someone made that folder a moment ago).
// Tabs can only be created here; renaming and deleting are git's job for now.

const bar: CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  height: 34,
  flex: "0 0 auto",
  borderTop: "1px solid var(--ui-border)",
  background: "var(--ui-surface-sunken)",
  fontFamily: "system-ui, sans-serif",
  fontSize: 12.5,
};

const tabStyle = (active: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  padding: "0 14px",
  border: "none",
  borderRight: "1px solid var(--ui-border)",
  background: active ? "var(--ui-surface)" : "transparent",
  boxShadow: active ? "inset 0 2px 0 var(--ui-accent)" : "none",
  color: active ? "var(--ui-ink)" : "var(--ui-muted)",
  font: "inherit", // before fontWeight: the shorthand would reset it
  fontWeight: active ? 600 : 400,
  whiteSpace: "nowrap",
  cursor: active ? "default" : "pointer",
});

export const UnsyncedDot = () => (
  <span
    title="Unsynced changes"
    aria-label="unsynced changes"
    style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--ui-warn)", flex: "0 0 auto" }}
  />
);

export default function TabBar({
  tabs,
  active,
  unsynced,
  onSelect,
  onCreate,
}: {
  tabs: readonly string[];
  active: string | null;
  unsynced: boolean; // of the active tab: only one diagram is on the canvas
  onSelect: (name: string) => void;
  // Resolves to null once the diagram exists, or to why it could not be made.
  onCreate: (name: string) => Promise<string | null>;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <div role="tablist" aria-label="Diagrams" style={bar}>
      <div style={{ display: "flex", alignItems: "stretch", overflowX: "auto", minWidth: 0 }}>
        {tabs.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={name === active}
            title={name}
            onClick={() => name !== active && onSelect(name)}
            style={tabStyle(name === active)}
          >
            {name}
            {name === active && unsynced && <UnsyncedDot />}
          </button>
        ))}
      </div>
      {creating ? (
        <div style={{ display: "flex", alignItems: "center", padding: "0 8px" }}>
          <NameField
            existing={tabs}
            placement="above"
            onCreate={async (name) => {
              const problem = await onCreate(name);
              if (problem === null) setCreating(false);
              return problem;
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          title="New diagram"
          aria-label="New diagram"
          onClick={() => setCreating(true)}
          style={{ ...tabStyle(false), padding: "0 12px", fontSize: 16, color: "var(--ui-ink-3)" }}
        >
          +
        </button>
      )}
    </div>
  );
}

/**
 * A new diagram's name: checked as it is typed, created on Enter, dropped on
 * Esc. Shared by the tab bar's `+` and the empty repo's panel.
 */
export function NameField({
  existing,
  onCreate,
  onCancel,
  placement = "below",
  size = "small",
}: {
  existing: readonly string[];
  onCreate: (name: string) => Promise<string | null>;
  onCancel: () => void;
  placement?: "above" | "below"; // where the message goes: the tab bar has no room below it
  size?: "small" | "large"; // large on an empty repo's page, where it is the only thing to do
}) {
  const [name, setName] = useState("");
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const problem = name ? checkDiagramName(name, existing) : null;
  const message = problem?.message ?? refused;
  const large = size === "large";
  const blocked = busy || !name || Boolean(problem);

  const submit = async () => {
    if (busy || !name || problem) return;
    setBusy(true);
    const answer = await onCreate(name).catch((e: unknown) => (e instanceof Error ? e.message : "Could not create it."));
    setBusy(false);
    setRefused(answer);
    if (answer !== null) inputRef.current?.focus();
  };

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
      <input
        ref={inputRef}
        aria-label="New diagram name"
        aria-invalid={Boolean(message)}
        placeholder="New diagram name"
        value={name}
        disabled={busy}
        spellCheck={false}
        maxLength={80}
        onChange={(e) => {
          setName(e.target.value);
          setRefused(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        onBlur={() => {
          if (!name && !busy) onCancel();
        }}
        style={{
          height: large ? 32 : 24,
          width: large ? 240 : 180,
          padding: large ? "0 10px" : "0 8px",
          borderRadius: large ? 8 : 6,
          border: `1px solid ${message ? "var(--ui-danger)" : "var(--ui-accent)"}`,
          outline: "none",
          background: "var(--ui-surface)",
          color: "var(--ui-ink)",
          font: "inherit",
          fontSize: large ? 13 : 12.5,
        }}
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()} // keep the field focused, so blur does not cancel it
        onClick={() => void submit()}
        disabled={blocked}
        style={
          large
            ? primaryButton(blocked)
            : {
                height: 24,
                padding: "0 10px",
                borderRadius: 6,
                border: "1px solid var(--ui-border-strong)",
                background: "var(--ui-surface)",
                color: "var(--ui-ink-2)",
                font: "inherit",
                fontSize: 12,
                cursor: blocked ? "not-allowed" : "pointer",
                opacity: blocked ? 0.6 : 1,
              }
        }
      >
        Create
      </button>
      {message && (
        <div
          role="alert"
          style={{
            position: "absolute",
            left: 0,
            ...(placement === "above" ? { bottom: "calc(100% + 8px)" } : { top: "calc(100% + 6px)" }),
            maxWidth: 320,
            width: "max-content",
            padding: "6px 9px",
            borderRadius: 7,
            border: "1px solid var(--ui-border-strong)",
            background: "var(--ui-surface)",
            boxShadow: "var(--ui-shadow-dialog)",
            color: "var(--ui-danger)",
            fontSize: 12,
            lineHeight: 1.4,
            zIndex: 20,
          }}
        >
          {message}
        </div>
      )}
    </div>
  );
}
