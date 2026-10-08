import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { Document } from "yaml";
import DialogFrame, {
  FileIcon,
  MONO,
  hintStyle,
  primaryButton,
  secondaryButton,
  smallButton,
  textareaStyle,
  wellStyle,
} from "./DialogFrame.tsx";
import { lineSpan, routeFiles, tally } from "./diagnostics.ts";
import type { LoadedFile } from "./diagnostics.ts";
import { detectKind, diagramName, importOrdo, readDiagram } from "../ordo/index.ts";
import type { Diagnostic } from "../ordo/index.ts";
import { joinDocuments } from "../ordo/read.ts";
import type { OrdoEdge, OrdoNode } from "../types.ts";

// Gets a diagram INTO the editor from its .ordo file: paste it, drop it on the
// dialog, or choose it. The file is read here in the browser and goes nowhere
// else.
//
// One file holds the whole diagram: the structure (`ordo: 1`), then `---`,
// then the layout (`ordo-layout: 1`), which may be left out. A layout kept in
// a file of its own (`<name>.layout.ordo`) can be dropped or chosen beside its
// diagram; the two are joined into the one text in the box, so every line
// number a problem points at is a line you can see. The text is read and
// validated as it changes: errors keep Import disabled, and warnings (a layout
// entry for an id the diagram does not have) are listed as entries the import
// will skip.

export type OrdoImportResult = {
  nodes: OrdoNode[];
  edges: OrdoEdge[];
  ordo: Document;
  layout: Document | null;
  name: string;
};

const ACCEPT = ".ordo,.yaml,.yml";

const PLACEHOLDER = `ordo: 1
nodes:
  - client
  - api
edges:
  - { id: e1, from: client, to: api }
---
ordo-layout: 1
nodes:
  client: { x: 0, y: 0 }
  api: { x: 240, y: 0 }`;

export default function OrdoImportDialog({
  open,
  onClose,
  canvasEmpty,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  // When it is not, Import asks first: the import replaces the canvas.
  canvasEmpty: boolean;
  onImport: (result: OrdoImportResult) => void;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const replaceRef = useRef<HTMLButtonElement>(null);

  // A fresh sheet every time it opens, with the caret already in the box.
  // Cleared as the dialog closes, so the first frame never shows last time's
  // text.
  useEffect(() => {
    if (!open) {
      setText("");
      setFile(null);
      setProblems([]);
      setDragging(false);
      setConfirming(false);
      return;
    }
    const id = requestAnimationFrame(() => areaRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (confirming) replaceRef.current?.focus();
  }, [confirming]);

  // Validation runs on deferred text, so typing never waits for it; Import
  // waits until it has caught up.
  const seen = useDeferredValue(text);
  const stale = seen !== text;
  const read = useMemo(() => (seen.trim() ? readDiagram(seen) : null), [seen]);

  const empty = text.trim() === "";
  const blocked = empty || stale || !read?.ok;

  const loadFiles = useCallback(
    async (list: FileList | null | undefined) => {
      const files = [...(list ?? [])];
      if (!files.length) return;
      let loaded: LoadedFile[];
      try {
        loaded = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
      } catch {
        setProblems([`Could not read ${files.map((f) => f.name).join(", ")}.`]);
        return;
      }
      const routed = routeFiles(loaded);
      const out = [...routed.problems];
      // The diagram's own file, or what is already in the box, takes a layout
      // dropped beside it, unless it already has one.
      let next = routed.ordo?.text ?? text;
      if (routed.ordo) setFile(routed.ordo.name);
      if (routed.layout) {
        if (!next.trim())
          out.push(`${routed.layout.name} is only a layout: drop or paste the diagram it belongs to as well.`);
        else if (readDiagram(next).layout)
          out.push(`${routed.ordo?.name ?? "The diagram"} already holds a layout; ${routed.layout.name} was not added.`);
        else next = joinDocuments(next.endsWith("\n") ? next : `${next}\n`, routed.layout.text);
      }
      setText(next);
      setProblems(out);
      setConfirming(false);
    },
    [text],
  );

  const runImport = useCallback(() => {
    const result = importOrdo(text);
    if (!result.ordo) return; // Import is disabled whenever this could happen
    onImport({
      nodes: result.nodes,
      edges: result.edges,
      ordo: result.ordo,
      layout: result.layout,
      name: diagramName(file),
    });
    onClose();
  }, [text, file, onImport, onClose]);

  const submit = useCallback(() => {
    if (blocked) return;
    if (!canvasEmpty && !confirming) {
      setConfirming(true);
      return;
    }
    runImport();
  }, [blocked, canvasEmpty, confirming, runImport]);

  // A problem, clicked: its line selected in the box.
  const reveal = (d: Diagnostic) => {
    const box = areaRef.current;
    if (!box) return;
    box.focus();
    if (d.line === undefined) return;
    const [start, end] = lineSpan(box.value, d.line);
    box.setSelectionRange(start, end);
    // Bring the line into view: a textarea does not scroll to a selection by itself.
    const lineHeight = parseFloat(getComputedStyle(box).lineHeight) || 20;
    box.scrollTop = Math.max(0, (d.line - 3) * lineHeight);
  };

  if (!open) return null;

  const diagnostics = [...(read?.diagnostics ?? [])].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  const label = file ?? "Diagram (.ordo)";
  const kind = !empty && !stale ? detectKind(seen) : null;
  const status = empty
    ? "Nothing pasted yet"
    : stale
      ? "Checking…"
      : diagnostics.length
        ? tally(diagnostics)
        : read?.layout
          ? "Valid Ordo v1: structure and layout"
          : kind === "ordo"
            ? "Valid Ordo v1: no layout, so it will be laid out on import"
            : "";

  return (
    <DialogFrame
      titleId="ordo-import-yaml-title"
      title="Import  Ordo YAML"
      subtitle="Paste a diagram's .ordo file, or drop it here."
      icon={<FileIcon inside="in" />}
      width={760}
      onClose={onClose}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          submit();
        }
      }}
      card={{
        onDragOver: (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDragging(true);
        },
        onDragLeave: (e) => {
          if (e.currentTarget === e.target) setDragging(false);
        },
        onDrop: (e) => {
          e.preventDefault();
          setDragging(false);
          void loadFiles(e.dataTransfer.files);
        },
      }}
      footer={
        confirming ? (
          <>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#b45309" }}>
              Replace the current diagram?
              <span style={{ fontWeight: 400, color: "#94a3b8" }}> ⌘Z undoes it.</span>
            </span>
            <button type="button" onClick={() => setConfirming(false)} style={secondaryButton}>
              Cancel
            </button>
            <button type="button" ref={replaceRef} onClick={runImport} style={primaryButton(false)}>
              Replace
            </button>
          </>
        ) : (
          <>
            <span style={hintStyle}>⌘↵ to import · Esc to close</span>
            <button type="button" onClick={onClose} style={secondaryButton}>
              Cancel
            </button>
            <button type="button" onClick={submit} disabled={blocked} style={primaryButton(blocked)}>
              Import
            </button>
          </>
        )
      }
    >
      <label
        htmlFor="ordo-import-diagram"
        style={{ display: "flex", gap: 6, alignItems: "baseline", marginBottom: 6, fontSize: 12.5, color: "#334155" }}
      >
        <span style={{ fontWeight: 600, fontFamily: file ? MONO : "inherit" }}>{label}</span>
        <span style={{ color: "#94a3b8" }}>the structure, then its layout after a --- line (optional)</span>
      </label>
      <div style={wellStyle(dragging)}>
        <textarea
          ref={areaRef}
          id="ordo-import-diagram"
          value={text}
          spellCheck={false}
          wrap="off"
          placeholder={PLACEHOLDER}
          onChange={(e) => {
            setText(e.target.value);
            if (!e.target.value.trim()) setFile(null);
            setProblems([]);
            setConfirming(false);
          }}
          style={{ ...textareaStyle, height: 300, whiteSpace: "pre", overflowX: "auto" }}
        />
        {dragging && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              borderRadius: 10,
              background: "rgba(238,242,255,.9)",
              color: "#4338ca",
              fontSize: 13,
              fontWeight: 600,
              pointerEvents: "none",
            }}
          >
            Drop the .ordo file
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, fontSize: 12 }}>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT}
          onChange={(e) => {
            void loadFiles(e.target.files);
            e.target.value = ""; // so the same file can be chosen twice
          }}
          style={{ display: "none" }}
        />
        <button type="button" onClick={() => fileRef.current?.click()} style={smallButton}>
          Choose file
        </button>
        <span
          role="status"
          style={{
            color: !empty && !stale && diagnostics.some((d) => d.severity === "error") ? "#b45309" : "#94a3b8",
          }}
        >
          {status}
        </span>
      </div>

      {problems.length > 0 && (
        <ul style={{ margin: "10px 0 0", paddingLeft: 18, color: "#b91c1c", fontSize: 12.5, lineHeight: 1.6 }}>
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {!stale && diagnostics.length > 0 && (
        <div style={{ marginTop: 12, maxHeight: 220, overflow: "auto" }}>
          <Diagnostics items={diagnostics} onPick={reveal} />
        </div>
      )}
    </DialogFrame>
  );
}

// The problems, as "line:col  message", in file order. A warning names an
// entry the import will skip.
function Diagnostics({ items, onPick }: { items: Diagnostic[]; onPick: (d: Diagnostic) => void }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 2 }}>
      {items.map((d, i) => (
        <li key={i}>
          <button
            type="button"
            onClick={() => onPick(d)}
            title={d.code}
            style={{
              display: "flex",
              gap: 10,
              width: "100%",
              padding: "3px 6px",
              border: "none",
              borderRadius: 6,
              background: "transparent",
              textAlign: "left",
              font: "inherit",
              fontSize: 12.5,
              color: d.severity === "error" ? "#0f172a" : "#64748b",
              cursor: d.line === undefined ? "default" : "pointer",
            }}
          >
            <code style={{ fontFamily: MONO, minWidth: 52, color: d.severity === "error" ? "#b91c1c" : "#b45309" }}>
              {d.line === undefined ? "—" : `${d.line}:${d.col ?? 1}`}
            </code>
            <span>
              {d.message}
              {d.severity === "warning" && <span style={{ color: "#94a3b8" }}> (will be ignored)</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
