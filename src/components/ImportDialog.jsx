import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";

// Gets Mermaid source INTO the app — paste it, drop a file on it, or browse for
// one. Nothing here knows what Mermaid means. `describe` (from whoever opened
// the dialog) says what the text is as soon as it arrives — which kind of
// diagram, whether it can be imported, and a warning when it is a kind that
// cannot be yet — and `onImport` converts it. The dialog closes once the import
// has landed; if it fails, the reason stays on screen and so does the text.

const ACCEPT = ".mmd,.mermaid,.md,.txt";

const PLACEHOLDER = `flowchart TD
  A([Start]) --> B{Ready?}
  B -- yes --> C[Ship it]
  B -- no --> A`;

export default function ImportDialog({ open, onClose, onImport, describe }) {
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const areaRef = useRef(null);

  // Fresh sheet every time it opens, and the caret is already in the box. The
  // sheet is cleared as the dialog CLOSES: cleared on opening, the first render
  // would still hold last time's text, and warn about it again.
  useEffect(() => {
    if (!open) {
      setText("");
      setFileName("");
      setError("");
      setDragging(false);
      setBusy(false);
      return;
    }
    const id = requestAnimationFrame(() => areaRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // { ok, label, warning } — read off the text itself, so a dropped file says
  // what it is before anyone presses Import.
  const found = useMemo(
    () => (describe && text.trim() ? describe(text) : null),
    [describe, text],
  );

  // A kind that cannot be imported yet is worth more than the status line. Its
  // warning goes up as a toast the moment the kind is recognised — once, not
  // per keystroke, since the warning's own text is its id — and comes down when
  // the text turns into something else or the dialog closes.
  const warning = open ? (found?.warning ?? null) : null;
  useEffect(() => {
    if (!warning) return;
    toast.warn(warning, { toastId: warning });
    return () => toast.dismiss(warning);
  }, [warning]);

  const readFile = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setError(`Could not read ${file.name}.`);
    reader.onload = () => {
      setText(String(reader.result ?? ""));
      setFileName(file.name);
      setError("");
    };
    reader.readAsText(file);
  }, []);

  const submit = useCallback(async () => {
    const source = text.trim();
    if (!source) {
      setError("Paste some Mermaid text, or drop a file in.");
      areaRef.current?.focus();
      return;
    }
    if (found && !found.ok) {
      setError(found.label);
      // asked again after the toast has gone: raise it again
      if (found.warning) toast.warn(found.warning, { toastId: found.warning });
      return;
    }
    if (busy) return;

    setBusy(true);
    setError("");
    try {
      await onImport(source, { fileName });
      onClose();
    } catch (err) {
      setError(err?.message || "The import failed.");
    } finally {
      setBusy(false);
    }
  }, [text, fileName, found, busy, onImport, onClose]);

  if (!open) return null;

  const empty = text.trim() === "";
  const blocked = empty || busy || (found ? !found.ok : false);
  const lineCount = text ? text.split("\n").length : 0;
  const status = [
    fileName,
    lineCount ? `${lineCount} lines` : "",
    found?.label ?? "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        display: "grid",
        placeItems: "center",
        padding: 20,
        background: "rgba(15,23,42,.45)",
        backdropFilter: "blur(3px)",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ordo-import-title"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
        style={{
          width: "min(680px, 100%)",
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e2e8f0",
          boxShadow:
            "0 24px 60px -12px rgba(15,23,42,.32), 0 0 0 1px rgba(15,23,42,.04)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "16px 18px",
            borderBottom: "1px solid #eef2f6",
          }}
        >
          <div
            aria-hidden
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              display: "grid",
              placeItems: "center",
              background: "linear-gradient(135deg,#eef2ff,#e0e7ff)",
              color: "#4338ca",
              flex: "0 0 auto",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
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
          </div>

          <div style={{ minWidth: 0, flex: 1 }}>
            <h2
              id="ordo-import-title"
              style={{ margin: 0, fontSize: 15, color: "#0f172a" }}
            >
              Import Mermaid
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "#64748b" }}>
              Paste the diagram source, or drop a {ACCEPT.split(",")[0]} file in
              the box.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close"
            style={{
              width: 30,
              height: 30,
              display: "grid",
              placeItems: "center",
              borderRadius: 7,
              border: "1px solid transparent",
              background: "transparent",
              color: "#64748b",
              cursor: "pointer",
              flex: "0 0 auto",
            }}
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path
                d="M3.5 3.5l8 8M11.5 3.5l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div style={{ padding: 18 }}>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              readFile(e.dataTransfer.files?.[0]);
            }}
            style={{
              position: "relative",
              borderRadius: 10,
              border: `1.5px ${dragging ? "dashed" : "solid"} ${
                dragging ? "#6366f1" : "#cbd5e1"
              }`,
              background: dragging ? "#eef2ff" : "#f8fafc",
              transition: "border-color .15s, background .15s",
            }}
          >
            <textarea
              ref={areaRef}
              id="ordo-import-source"
              value={text}
              spellCheck={false}
              onChange={(e) => {
                setText(e.target.value);
                setFileName("");
                setError("");
              }}
              placeholder={PLACEHOLDER}
              style={{
                display: "block",
                width: "100%",
                height: 240,
                boxSizing: "border-box",
                resize: "vertical",
                padding: "12px 14px",
                border: "none",
                outline: "none",
                borderRadius: 10,
                background: "transparent",
                color: "#0f172a",
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                fontSize: 12.5,
                lineHeight: 1.6,
                tabSize: 2,
              }}
            />

            {dragging && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 10,
                  background: "rgba(238,242,255,.85)",
                  color: "#4338ca",
                  fontSize: 13,
                  fontWeight: 600,
                  pointerEvents: "none",
                }}
              >
                Drop to load the file
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 10,
              minHeight: 22,
              fontSize: 12,
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              onChange={(e) => {
                readFile(e.target.files?.[0]);
                e.target.value = ""; // so the same file can be picked twice
              }}
              style={{ display: "none" }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 28,
                padding: "0 10px",
                borderRadius: 7,
                border: "1px solid #cbd5e1",
                background: "#fff",
                color: "#334155",
                font: "inherit",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path
                  d="M7 9.5V2m0 0L4.25 4.75M7 2l2.75 2.75M2 9v1.5A1.5 1.5 0 0 0 3.5 12h7a1.5 1.5 0 0 0 1.5-1.5V9"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Choose file
            </button>

            <span
              title={error || status}
              style={{
                color: error
                  ? "#dc2626"
                  : found && !found.ok
                    ? "#b45309"
                    : "#94a3b8",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {error || (empty ? "Nothing pasted yet" : status)}
            </span>
          </div>
        </div>

        <footer
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 18px",
            borderTop: "1px solid #eef2f6",
            background: "#fcfdfe",
          }}
        >
          <span style={{ flex: 1, fontSize: 11.5, color: "#94a3b8" }}>
            ⌘↵ to import · Esc to close
          </span>

          <button
            type="button"
            onClick={onClose}
            style={{
              height: 32,
              padding: "0 14px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: "#fff",
              color: "#334155",
              font: "inherit",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={submit}
            disabled={blocked}
            style={{
              height: 32,
              padding: "0 16px",
              borderRadius: 8,
              border: "none",
              font: "inherit",
              fontSize: 13,
              fontWeight: 600,
              color: "#fff",
              cursor: busy ? "progress" : blocked ? "not-allowed" : "pointer",
              background: blocked
                ? "#c7d2fe"
                : "linear-gradient(180deg,#6366f1,#4f46e5)",
              boxShadow: blocked ? "none" : "0 1px 2px rgba(79,70,229,.45)",
            }}
          >
            {busy ? "Importing…" : "Import"}
          </button>
        </footer>
      </div>
    </div>
  );
}
