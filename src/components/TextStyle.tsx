import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Panel } from "@xyflow/react";
import {
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  TEXT_WEIGHTS,
  WEIGHT_LABELS,
  clampTextSize,
  weightValue,
} from "../textStyle.ts";
import type { TextSummary, TextWeight } from "../textStyle.ts";

// The text bar: how big and how heavy the selection's text is. It shows over
// the canvas whenever something with text is selected — nodes and lines alike,
// so one bar restyles a mixed selection — and acts on all of it at once. The
// steppers move each item from its own size, so a title stays bigger than the
// body text selected with it; typing a size sets them all to it.

const bar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: 4,
  borderRadius: 8,
  border: "1px solid var(--ui-border-strong)",
  background: "var(--ui-surface)",
  boxShadow: "0 6px 20px -8px rgba(15, 23, 42, 0.35)",
  fontFamily: "system-ui, sans-serif",
  fontSize: 12.5,
  color: "var(--ui-ink)",
};

const button = (active = false): CSSProperties => ({
  height: 26,
  minWidth: 26,
  padding: "0 8px",
  display: "grid",
  placeItems: "center",
  borderRadius: 5,
  cursor: "pointer",
  font: "inherit",
  color: active ? "var(--ui-accent-ink)" : "var(--ui-ink)",
  border: `1px solid ${active ? "var(--ui-accent)" : "transparent"}`,
  background: active ? "var(--ui-accent-soft)" : "transparent",
});

const Divider = () => (
  <span
    aria-hidden
    style={{ width: 1, alignSelf: "stretch", margin: "3px 2px", background: "var(--ui-border)" }}
  />
);

const Caption = ({ children }: { children: ReactNode }) => (
  <span
    style={{
      padding: "0 6px 0 4px",
      fontSize: 10.5,
      letterSpacing: ".08em",
      textTransform: "uppercase",
      fontWeight: 600,
      color: "var(--ui-faint)",
    }}
  >
    {children}
  </span>
);

export default function TextStyle({
  text,
  onStep,
  onSize,
  onWeight,
  onReset,
}: {
  text: TextSummary;
  onStep: (delta: number) => void; // each item from its own size
  onSize: (size: number) => void; // every item to this size
  onWeight: (weight: TextWeight) => void;
  onReset: () => void; // back to each kind's own size and weight
}) {
  // While the size field has focus it shows what is being typed; otherwise
  // the selection's size, or nothing when the items differ.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (text.size === null ? "" : String(text.size));

  const commit = () => {
    const n = Number.parseFloat(draft ?? "");
    if (draft !== null && Number.isFinite(n)) onSize(clampTextSize(n));
    setDraft(null);
  };

  return (
    <Panel position="top-center">
      <div role="toolbar" aria-label="Text style" style={bar}>
        <Caption>Text</Caption>

        <button
          type="button"
          title="Smaller text"
          aria-label="Smaller text"
          disabled={text.size !== null && text.size <= TEXT_SIZE_MIN}
          onClick={() => onStep(-1)}
          style={button()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M1.5 5h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <input
          id="ordo-text-size"
          type="text"
          inputMode="numeric"
          aria-label={`Text size, ${TEXT_SIZE_MIN} to ${TEXT_SIZE_MAX} px`}
          title={text.size === null ? "Mixed sizes: type one to set them all" : "Text size in px"}
          placeholder="–"
          value={shown}
          onFocus={(e) => {
            setDraft(shown);
            e.currentTarget.select();
          }}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ""))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") {
              setDraft(null);
              // the draft is dropped first, so the blur has nothing to commit
              requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              setDraft(null);
              onStep(e.key === "ArrowUp" ? 1 : -1);
            }
          }}
          style={{
            width: 38,
            height: 26,
            boxSizing: "border-box",
            textAlign: "center",
            borderRadius: 5,
            border: "1px solid var(--ui-border-strong)",
            background: "var(--ui-surface-sunken)",
            color: "var(--ui-ink)",
            font: "inherit",
            fontVariantNumeric: "tabular-nums",
            padding: 0,
          }}
        />
        <button
          type="button"
          title="Larger text"
          aria-label="Larger text"
          disabled={text.size !== null && text.size >= TEXT_SIZE_MAX}
          onClick={() => onStep(1)}
          style={button()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M1.5 5h7M5 1.5v7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        <Divider />

        {TEXT_WEIGHTS.map((w) => (
          <button
            key={w}
            type="button"
            aria-pressed={text.weight === w}
            onClick={() => onWeight(w)}
            style={{ ...button(text.weight === w), fontWeight: weightValue(w) }}
          >
            {WEIGHT_LABELS[w]}
          </button>
        ))}

        {text.restyled && (
          <>
            <Divider />
            <button
              type="button"
              title="Back to each item's own size and weight"
              onClick={onReset}
              style={{ ...button(), color: "var(--ui-muted)" }}
            >
              Reset
            </button>
          </>
        )}
      </div>
    </Panel>
  );
}
