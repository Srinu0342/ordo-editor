import type { ReactNode } from "react";
import { MONO, primaryButton, secondaryButton } from "./DialogFrame.tsx";
import { DiagnosticList } from "./SyncDialog.tsx";
import { NameField } from "./TabBar.tsx";
import { DIAGRAM_FILE } from "../local/api.ts";
import type { Diagnostic } from "../ordo/index.ts";

// What a repo shows when there is no diagram to draw on: a repo with none yet,
// a repo that cannot be opened, or a file that does not read. Each says what
// is going on and offers the one or two ways forward. The first two are pages
// of their own (see Landing); a file that does not read covers the canvas, so
// the tabs stay in reach.

export type LocalPanelKind = "empty" | "invalid" | "error";

export function LocalCard({
  kind,
  repo,
  tab,
  message,
  diagnostics,
  tabs = [],
  onCreate,
  onLeave,
}: {
  kind: LocalPanelKind;
  repo: string;
  tab?: string | null;
  message?: string;
  diagnostics?: Diagnostic[];
  tabs?: readonly string[];
  onCreate?: (name: string) => Promise<string | null>; // an empty repo's first diagram
  onLeave?: () => void; // back to the projects page
}) {
  const where = repo || "the workspace root";
  const name = repo.split("/").filter(Boolean).at(-1) ?? where; // the header has the rest of the path

  let body: ReactNode;
  if (kind === "empty") {
    body = (
      <>
        <h2 style={heading} title={where}>
          No diagrams in {name} yet
        </h2>
        <p style={text}>
          Name the first one. It's saved as <code style={code}>.ordo/&lt;name&gt;/{DIAGRAM_FILE}</code>, and nothing is
          written until you create it.
        </p>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 18 }}>
          <NameField existing={tabs} onCreate={onCreate ?? noCreate} onCancel={() => {}} size="large" />
        </div>
        <button type="button" onClick={onLeave} style={{ ...linkButton, marginTop: 18 }}>
          Choose another folder
        </button>
      </>
    );
  } else if (kind === "invalid") {
    body = (
      <>
        <h2 style={heading}>
          <code style={code}>
            {tab}/{DIAGRAM_FILE}
          </code>{" "}
          doesn't read as an Ordo diagram
        </h2>
        <p style={text}>Fix the file and it loads within a few seconds, or press Sync to load it now.</p>
        <div style={{ textAlign: "left", marginTop: 12 }}>
          <DiagnosticList title={`${tab}/${DIAGRAM_FILE}`} items={diagnostics ?? []} />
        </div>
      </>
    );
  } else {
    body = (
      <>
        <h2 style={heading}>Can't open {where}</h2>
        <p style={text}>{message ?? "The Ordo server didn't answer."}</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
          <button type="button" onClick={onLeave} style={primaryButton(false)}>
            Choose another folder
          </button>
        </div>
      </>
    );
  }

  return (
    <div
      role="status"
      style={{
        width: `min(${kind === "invalid" ? 620 : 480}px, 100%)`,
        boxSizing: "border-box",
        padding: "26px 28px",
        borderRadius: 14,
        border: "1px solid var(--ui-border)",
        background: "var(--ui-surface)",
        boxShadow: "var(--ui-shadow-dialog)",
        textAlign: "center",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {body}
    </div>
  );
}

/** A file that does not read, over the canvas it would have filled. */
export default function LocalPanel({ tab, diagnostics }: { tab: string | null; diagnostics?: Diagnostic[] }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 10,
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "var(--ui-surface-sunken)",
      }}
    >
      <LocalCard kind="invalid" repo="" tab={tab} diagnostics={diagnostics} />
    </div>
  );
}

const noCreate = async () => "Open a repo first.";

const heading = { margin: 0, fontSize: 16, fontWeight: 600, color: "var(--ui-ink)" };
const text = { margin: "8px 0 0", fontSize: 13, lineHeight: 1.55, color: "var(--ui-muted)" };
const code = { fontFamily: MONO, fontSize: "0.92em", color: "var(--ui-ink-2)" };
const linkButton = {
  ...secondaryButton,
  height: "auto",
  padding: 0,
  border: "none",
  background: "transparent",
  color: "var(--ui-accent-ink)",
  fontSize: 12.5,
};
