import type { ReactNode } from "react";
import RepoBrowser from "./RepoBrowser.tsx";

// Every page that is not the editor: the header, then one card in the middle
// of a quiet dotted field. Only a repo with a diagram to open gets the canvas
// and its tools; picking a project, an empty repo, and a repo that cannot be
// opened are all just a card.

export default function Landing({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100vw", height: "100vh" }}>
      {header}
      <main
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          display: "grid",
          placeItems: "center",
          padding: "40px 20px",
          backgroundColor: "var(--ui-surface-sunken)",
          backgroundImage: "radial-gradient(var(--ui-border-strong) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {children}
      </main>
    </div>
  );
}

/** The start page: no repo is open, so there is nothing to draw on until one is picked. */
export function ProjectsCard({ onOpen }: { onOpen: (repo: string) => void }) {
  return (
    <section
      aria-labelledby="ordo-projects-title"
      style={{
        width: "min(680px, 100%)",
        boxSizing: "border-box",
        padding: "26px 28px 24px",
        borderRadius: 14,
        border: "1px solid var(--ui-border)",
        background: "var(--ui-surface)",
        boxShadow: "var(--ui-shadow-dialog)",
      }}
    >
      <h1 id="ordo-projects-title" style={{ margin: 0, fontSize: 19, fontWeight: 650, color: "var(--ui-ink)" }}>
        Open a project
      </h1>
      <p style={{ margin: "6px 0 22px", fontSize: 13, lineHeight: 1.55, color: "var(--ui-muted)" }}>
        Pick a folder, usually a repo. Its diagrams live in <code style={{ fontSize: "0.95em" }}>.ordo/</code> at its
        top, one tab each. Opening a folder writes nothing.
      </p>
      <RepoBrowser onOpen={onOpen} />
    </section>
  );
}

/** While a repo's list of diagrams is on its way. */
export function OpeningCard({ name }: { name: string }) {
  return (
    <p role="status" style={{ margin: 0, fontSize: 13.5, color: "var(--ui-muted)" }}>
      Opening {name}…
    </p>
  );
}
