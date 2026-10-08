import { useEffect, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { toast } from "react-toastify";
import type { Document } from "yaml";
import DialogFrame, { FileIcon, MONO, hintStyle, secondaryButton, smallButton } from "./DialogFrame.tsx";
import { groupDiagnostics, plural } from "./diagnostics.ts";
import { exportOrdo, fileName } from "../ordo/index.ts";
import type { OrdoExport, OrdoSession } from "../ordo/index.ts";
import type { OrdoEdge, OrdoNode } from "../types.ts";

// The canvas as its .ordo file — the structure, then `---`, then the layout —
// with one Copy button.
//
// The export runs once, as the dialog opens: the canvas cannot change while
// the dialog covers it. It patches the session's documents (from the last
// import or export) rather than writing fresh files, so comments and order a
// file came in with survive, and on success the patched documents become the
// session's — which is why opening the dialog twice in a row shows the same
// bytes. Nothing leaves the browser.

// How many messages of one kind are listed before the rest are counted.
const SHOWN_PER_CODE = 20;

/**
 * Copy `text` to the clipboard. navigator.clipboard needs a secure context, so
 * a copy served over plain http (a Docker instance on a LAN address, say) falls
 * back to the old route: a hidden textarea and execCommand("copy").
 */
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the old route
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.readOnly = true;
  Object.assign(area.style, { position: "fixed", top: "0", left: "0", opacity: "0", pointerEvents: "none" });
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

/** Select everything in `el`, so a copy that failed can be finished by hand. */
function selectAll(el: HTMLElement | null) {
  const selection = window.getSelection();
  if (!el || !selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
}

export default function ViewYamlDialog({
  open,
  onClose,
  session,
  onExported,
}: {
  open: boolean;
  onClose: () => void;
  session: OrdoSession;
  // Called with the patched documents when the export succeeds; they become
  // the session's baseline.
  onExported: (docs: { ordo: Document; layout: Document }) => void;
}) {
  const { getNodes, getEdges } = useReactFlow<OrdoNode, OrdoEdge>();
  const [result, setResult] = useState<OrdoExport | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const focusRef = useRef<HTMLButtonElement>(null);

  // Read through refs: storing the export's documents updates the session,
  // and that must not run the export again.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const exportedRef = useRef(onExported);
  exportedRef.current = onExported;

  useEffect(() => {
    if (!open) {
      setResult(null);
      return;
    }
    const out = exportOrdo(getNodes(), getEdges(), sessionRef.current);
    setResult(out);
    if (out.ordo && out.layout) exportedRef.current({ ordo: out.ordo.doc, layout: out.layout.doc });
  }, [open, getNodes, getEdges]);

  // Focus lands inside the dialog, so Esc reaches it.
  useEffect(() => {
    if (!result) return;
    const id = requestAnimationFrame(() => focusRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [result]);

  if (!open || !result) return null;

  const name = fileName(session.name);
  const text = result.text;

  const copy = async () => {
    if (text === null) return;
    const ok = await copyText(text);
    focusRef.current?.focus();
    if (ok) toast.success(`Copied ${name}`, { toastId: "ordo-copied", autoClose: 1800 });
    else {
      selectAll(preRef.current);
      toast.error("Could not copy. The text is selected: press ⌘C (Ctrl+C) to copy it.", { toastId: "ordo-copy-failed" });
    }
  };

  return (
    <DialogFrame
      titleId="ordo-view-title"
      title="View Ordo YAML"
      subtitle={
        text !== null ? (
          <>
            The canvas as <code>{name}</code>: its structure, then its layout after the <code>---</code>.
          </>
        ) : (
          "Nothing was written."
        )
      }
      icon={<FileIcon inside="code" />}
      width={760}
      onClose={onClose}
      footer={
        <>
          <span style={hintStyle}>Esc to close</span>
          <button type="button" onClick={onClose} style={secondaryButton} ref={text !== null ? undefined : focusRef}>
            Close
          </button>
        </>
      }
    >
      {text !== null ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <code style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: "#3730a3" }}>{name}</code>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: "#94a3b8" }}>{plural(text.split("\n").filter(Boolean).length, "line")}</span>
            <button type="button" ref={focusRef} onClick={copy} style={smallButton} title={`Copy ${name}`}>
              Copy
            </button>
          </div>
          <pre
            ref={preRef}
            tabIndex={0}
            aria-label={name}
            style={{
              margin: 0,
              maxHeight: "min(60vh, 560px)",
              overflow: "auto",
              whiteSpace: "pre",
              padding: "12px 14px",
              borderRadius: 10,
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
              color: "#0f172a",
              fontFamily: MONO,
              fontSize: 12.5,
              lineHeight: 1.6,
              tabSize: 2,
            }}
          >
            {text}
          </pre>
        </>
      ) : (
        <Refusal result={result} />
      )}
    </DialogFrame>
  );
}

// Why the canvas cannot be written. Everything the editor draws has a place in
// the format, so this only shows for a node or edge that came from outside it;
// even then the messages are grouped by code and each group cut off with a
// count, so hundreds of them still read as a list a person can take in.
function Refusal({ result }: { result: OrdoExport }) {
  const groups = groupDiagnostics(result.diagnostics.filter((d) => d.severity === "error"));
  const list = (
    <div style={{ display: "grid", gap: 10 }}>
      {groups.map((g) => (
        <div key={g.code}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
            <code style={{ fontFamily: MONO }}>{g.code}</code>
            <span style={{ fontWeight: 400, color: "#94a3b8" }}> · {g.items.length}</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 2 }}>
            {g.items.slice(0, SHOWN_PER_CODE).map((d, i) => (
              <li key={i} style={{ fontSize: 12.5, color: "#0f172a", lineHeight: 1.5 }}>
                <code style={{ fontFamily: MONO, color: "#b91c1c", marginRight: 8 }}>{d.code}</code>
                {d.message}
              </li>
            ))}
            {g.items.length > SHOWN_PER_CODE && (
              <li style={{ fontSize: 12.5, color: "#64748b", listStyle: "none" }}>
                and {g.items.length - SHOWN_PER_CODE} more like these
              </li>
            )}
          </ul>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <p style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "#b45309" }}>
        This canvas can't be exported as Ordo YAML: {plural(result.diagnostics.length, "problem")}
      </p>
      <div style={{ maxHeight: "min(52vh, 480px)", overflow: "auto" }}>{list}</div>
    </div>
  );
}
