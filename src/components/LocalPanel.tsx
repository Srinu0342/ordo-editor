import { useState } from "react";
import type { ReactNode } from "react";
import { MONO, primaryButton, secondaryButton } from "./DialogFrame.tsx";
import { DiagnosticList } from "./SyncDialog.tsx";
import { NameField } from "./TabBar.tsx";
import { DIAGRAM_FILE } from "../local/api.ts";
import type { Diagnostic } from "../ordo/index.ts";

// What covers the canvas in local mode when there is no diagram to draw on:
// a repo with none yet, a file that does not read, or a repo that cannot be
// opened. Each says what is going on and offers the one or two ways forward.

export type LocalPanelKind = "empty" | "invalid" | "error";

export default function LocalPanel({
  kind,
  repo,
  tab,
  message,
  diagnostics,
  tabs = [],
  onCreate,
  onOpenRepo,
  onFree,
}: {
  kind: LocalPanelKind;
  repo: string;
  tab?: string | null;
  message?: string;
  diagnostics?: Diagnostic[];
  tabs?: readonly string[];
  onCreate: (name: string) => Promise<string | null>;
  onOpenRepo: () => void;
  onFree: () => void;
}) {
  const [naming, setNaming] = useState(false);
  const where = repo || "the workspace root";

  let body: ReactNode;
  if (kind === "empty") {
    body = (
      <>
        <h2 style={heading}>No diagrams in {where} yet</h2>
        <p style={text}>
          Each diagram is a file at <code style={code}>.ordo/&lt;name&gt;/{DIAGRAM_FILE}</code>. Nothing is written until you
          create one.
        </p>
        {naming ? (
          <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
            <NameField existing={tabs} onCreate={onCreate} onCancel={() => setNaming(false)} />
          </div>
        ) : (
          <button type="button" onClick={() => setNaming(true)} style={{ ...primaryButton(false), marginTop: 14 }}>
            + New diagram
          </button>
        )}
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
        <p style={text}>Fix the file, then press Sync to load it.</p>
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
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
          <button type="button" onClick={onOpenRepo} style={primaryButton(false)}>
            Open another repo
          </button>
          <button type="button" onClick={onFree} style={secondaryButton}>
            Free-form
          </button>
        </div>
      </>
    );
  }

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
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        role="status"
        style={{
          width: `min(${kind === "invalid" ? 620 : 460}px, 100%)`,
          padding: "24px 26px",
          borderRadius: 14,
          border: "1px solid var(--ui-border)",
          background: "var(--ui-surface)",
          boxShadow: "var(--ui-shadow-dialog)",
          textAlign: "center",
        }}
      >
        {body}
      </div>
    </div>
  );
}

const heading = { margin: 0, fontSize: 15, fontWeight: 600, color: "var(--ui-ink)" };
const text = { margin: "8px 0 0", fontSize: 13, lineHeight: 1.5, color: "var(--ui-muted)" };
const code = { fontFamily: MONO, fontSize: "0.92em", color: "var(--ui-ink-2)" };
