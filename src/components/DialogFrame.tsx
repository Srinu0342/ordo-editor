import type { CSSProperties, HTMLAttributes, KeyboardEvent, ReactNode } from "react";

// The chrome the .ordo dialogs share with the Mermaid ImportDialog: a blurred
// backdrop that closes on a click, a card with an icon tile, a title and a
// subtitle, a close button, a body and a footer. The values are the
// ImportDialog's own, so the three read as one family; only the content of
// each differs.

export const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// The text boxes the dialogs hold, on the tinted well ImportDialog puts its
// own in.
export const wellStyle = (active = false): CSSProperties => ({
  position: "relative",
  borderRadius: 10,
  border: `1.5px ${active ? "dashed" : "solid"} ${active ? "#6366f1" : "#cbd5e1"}`,
  background: active ? "#eef2ff" : "#f8fafc",
  transition: "border-color .15s, background .15s",
});

export const textareaStyle: CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  resize: "vertical",
  padding: "12px 14px",
  border: "none",
  outline: "none",
  borderRadius: 10,
  background: "transparent",
  color: "#0f172a",
  fontFamily: MONO,
  fontSize: 12.5,
  lineHeight: 1.6,
  tabSize: 2,
};

// One line of a textarea, in px: fontSize × lineHeight above.
export const LINE_PX = 12.5 * 1.6;

export const smallButton: CSSProperties = {
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
  whiteSpace: "nowrap",
};

export const secondaryButton: CSSProperties = {
  height: 32,
  padding: "0 14px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#334155",
  font: "inherit",
  fontSize: 13,
  cursor: "pointer",
};

export const primaryButton = (blocked: boolean): CSSProperties => ({
  height: 32,
  padding: "0 16px",
  borderRadius: 8,
  border: "none",
  font: "inherit",
  fontSize: 13,
  fontWeight: 600,
  color: "#fff",
  cursor: blocked ? "not-allowed" : "pointer",
  background: blocked ? "#c7d2fe" : "linear-gradient(180deg,#6366f1,#4f46e5)",
  boxShadow: blocked ? "none" : "0 1px 2px rgba(79,70,229,.45)",
});

export const hintStyle: CSSProperties = { flex: 1, fontSize: 11.5, color: "#94a3b8" };

export default function DialogFrame({
  titleId,
  title,
  subtitle,
  icon,
  width = 680,
  onClose,
  onKeyDown,
  card,
  footer,
  children,
}: {
  titleId: string;
  title: string;
  subtitle: ReactNode;
  icon: ReactNode;
  width?: number;
  onClose: () => void;
  // Esc is handled here; this sees every other key first.
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  // Anything else the card itself takes, such as drop handlers.
  card?: HTMLAttributes<HTMLDivElement>;
  footer: ReactNode;
  children: ReactNode;
}) {
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
        aria-labelledby={titleId}
        {...card}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
            return;
          }
          onKeyDown?.(e);
        }}
        style={{
          position: "relative",
          width: `min(${width}px, 100%)`,
          maxHeight: "calc(100vh - 40px)",
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
            {icon}
          </div>

          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 id={titleId} style={{ margin: 0, fontSize: 15, color: "#0f172a" }}>
              {title}
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "#64748b" }}>
              {subtitle}
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

        <div style={{ padding: 18, overflow: "auto", minHeight: 0 }}>{children}</div>

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
          {footer}
        </footer>
      </div>
    </div>
  );
}

// The file icon both .ordo dialogs and their toolbar buttons wear: a page with
// a folded corner, and what is being done with it drawn inside.
export function FileIcon({ size = 18, inside }: { size?: number; inside: "in" | "code" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M4.25 1.75h6.5l3.5 3.5v9.5a1.5 1.5 0 0 1-1.5 1.5h-8.5a1.5 1.5 0 0 1-1.5-1.5v-11.5a1.5 1.5 0 0 1 1.5-1.5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {inside === "in" ? (
        <path
          d="M9 6.75v6m0 0l-2.4-2.4M9 12.75l2.4-2.4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M7.25 8l-2 2 2 2M10.75 8l2 2-2 2"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
