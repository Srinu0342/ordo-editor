import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { checkDiagramName } from "../local/names.ts";
import { primaryButton } from "./DialogFrame.tsx";
import Popover, { MenuItem } from "./Popover.tsx";

// A repo's diagrams as footer tabs, Lucid-style: one per .ordo/<name>/ folder,
// A–Z, the open one raised. `+` turns into a name field that checks the name
// as you type, by the same rules the server enforces, and shows the server's
// own sentence if it still says no (someone made that folder a moment ago).
// The open tab's ⋯ menu renames it in place, through the same field (so does
// a double-click), or deletes it, which local mode asks about first.

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
  onRename,
  onDelete,
}: {
  tabs: readonly string[];
  active: string | null;
  unsynced: boolean; // of the active tab: only one diagram is on the canvas
  onSelect: (name: string) => void;
  // Each resolves to null once it is done, or to why it could not be.
  onCreate: (name: string) => Promise<string | null>;
  onRename: (from: string, name: string) => Promise<string | null>;
  onDelete: (name: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  // The open tab, while its name is being edited. Another tab opening (Back,
  // the file deleted on disk) ends the edit.
  const [renaming, setRenaming] = useState<string | null>(null);
  if (renaming !== null && renaming !== active) setRenaming(null);

  return (
    <div role="tablist" aria-label="Diagrams" style={bar}>
      <div style={{ display: "flex", alignItems: "stretch", overflowX: "auto", minWidth: 0 }}>
        {tabs.map((name) => {
          const open = name === active;
          if (open && renaming === name)
            return (
              <div key={name} style={{ ...tabStyle(true), padding: "0 8px" }}>
                <NameField
                  initial={name}
                  existing={tabs.filter((t) => t !== name)}
                  label="Diagram name"
                  action="Rename"
                  placement="above"
                  onSubmit={async (next) => {
                    const problem = await onRename(name, next);
                    if (problem === null) setRenaming(null);
                    return problem;
                  }}
                  onCancel={() => setRenaming(null)}
                />
              </div>
            );
          return (
            <Fragment key={name}>
              <button
                type="button"
                role="tab"
                aria-selected={open}
                title={name}
                onClick={() => !open && onSelect(name)}
                onDoubleClick={() => open && setRenaming(name)}
                // The open tab's ⋯ sits inside its raised face.
                style={open ? { ...tabStyle(true), borderRight: "none", paddingRight: 2 } : tabStyle(false)}
              >
                {name}
                {open && unsynced && <UnsyncedDot />}
              </button>
              {open && (
                <Popover
                  label="Diagram actions"
                  side="above"
                  align="start"
                  width={250}
                  button={<DotsIcon />}
                  buttonStyle={{ ...tabStyle(true), padding: "0 10px 0 6px", color: "var(--ui-ink-3)", cursor: "pointer" }}
                >
                  {(close) => (
                    <>
                      <MenuItem
                        icon={<PencilIcon />}
                        title="Rename"
                        hint="Its folder in .ordo moves with it."
                        onSelect={() => {
                          close();
                          setRenaming(name);
                        }}
                      />
                      <MenuItem
                        icon={<TrashIcon />}
                        title="Delete"
                        hint="Removes its file, after asking."
                        danger
                        onSelect={() => {
                          close();
                          onDelete(name);
                        }}
                      />
                    </>
                  )}
                </Popover>
              )}
            </Fragment>
          );
        })}
      </div>
      {creating ? (
        <div style={{ display: "flex", alignItems: "center", padding: "0 8px" }}>
          <NameField
            existing={tabs}
            placement="above"
            onSubmit={async (name) => {
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
 * A diagram's name: checked as it is typed, submitted on Enter, dropped on
 * Esc. A new one from the tab bar's `+` and the empty repo's panel; the open
 * tab's when it is renamed, which starts from its name and drops it unchanged.
 */
export function NameField({
  existing,
  onSubmit,
  onCancel,
  initial = "",
  label = "New diagram name",
  action = "Create",
  placement = "below",
  size = "small",
}: {
  existing: readonly string[]; // every other diagram's name
  onSubmit: (name: string) => Promise<string | null>;
  onCancel: () => void;
  initial?: string;
  label?: string; // the field's accessible name and placeholder
  action?: string; // the button's
  placement?: "above" | "below"; // where the message goes: the tab bar has no room below it
  size?: "small" | "large"; // large on an empty repo's page, where it is the only thing to do
}) {
  const [name, setName] = useState(initial);
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // The name it started with is no problem, even one made by hand that the rules refuse.
  const unchanged = name === initial;
  const problem = name && !unchanged ? checkDiagramName(name, existing) : null;
  const message = problem?.message ?? refused;
  const large = size === "large";
  const blocked = busy || !name || unchanged || Boolean(problem);

  // A message above goes on the page, not in the field's box: a renamed tab's
  // field sits in the tabs' scroller, which would clip it.
  const [above, setAbove] = useState<{ left: number; bottom: number } | null>(null);
  useLayoutEffect(() => {
    if (placement !== "above" || !message || !boxRef.current) return;
    const box = boxRef.current.getBoundingClientRect();
    setAbove({ left: box.left, bottom: window.innerHeight - box.top + 8 });
  }, [placement, message]);

  const submit = async () => {
    if (busy) return;
    if (initial && unchanged) return onCancel();
    if (!name || problem) return;
    setBusy(true);
    const answer = await onSubmit(name).catch((e: unknown) =>
      e instanceof Error ? e.message : `Could not ${action.toLowerCase()} it.`,
    );
    setBusy(false);
    setRefused(answer);
    if (answer !== null) inputRef.current?.focus();
  };

  return (
    <div ref={boxRef} style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
      <input
        ref={inputRef}
        aria-label={label}
        aria-invalid={Boolean(message)}
        placeholder={label}
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
          if (unchanged && !busy) onCancel();
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
        {action}
      </button>
      {message && (
        <div
          role="alert"
          style={{
            ...(placement === "above"
              ? { position: "fixed", left: above?.left ?? 0, bottom: above?.bottom ?? 0 }
              : { position: "absolute", left: 0, top: "calc(100% + 6px)" }),
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

const Icon = ({ children, size = 15 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden style={{ flex: "0 0 auto" }}>
    {children}
  </svg>
);

const DotsIcon = () => (
  <Icon size={14}>
    <path d="M3.75 9h.01M9 9h.01M14.25 9h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </Icon>
);

const PencilIcon = () => (
  <Icon>
    <path d="M11.75 3.25 14.75 6.25 6 15H3v-3l8.75-8.75zM9.75 5.25l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </Icon>
);

const TrashIcon = () => (
  <Icon>
    <path
      d="M2.75 4.75h12.5M7 4.75v-2h4v2M4.25 4.75l.75 10.5h8l.75-10.5M7.5 8v4.5M10.5 8v4.5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Icon>
);
