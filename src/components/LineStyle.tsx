import type { CSSProperties, ReactNode } from "react";
import { STROKE_SWATCHES, STROKE_WEIGHTS, LINE_TYPES, inkOf, lineTypeOf } from "../edgeStyle.ts";
import type { EdgeStyle } from "../edgeStyle.ts";
import { MARKERS, MARKER_KEYS } from "../edges/index.ts";
import { useCanvasTheme } from "../nodes/chrome.tsx";

// How a line looks: colour, weight, pattern and its two ends. Edits land on
// the lines selected on the canvas when there are any, and otherwise become
// the default for the next line drawn — the behaviour every drawing tool has,
// and the reason the panel says which it will do.

const label: CSSProperties = {
  fontSize: 10.5,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ui-faint)",
  fontWeight: 600,
  margin: "14px 0 6px",
};

const segment = (active: boolean): CSSProperties => ({
  flex: 1,
  height: 28,
  display: "grid",
  placeItems: "center",
  padding: 0,
  borderRadius: 5,
  cursor: "pointer",
  border: `1px solid ${active ? "var(--ui-accent)" : "var(--ui-border-strong)"}`,
  background: active ? "var(--ui-accent-soft)" : "var(--ui-surface)",
});

const selectStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 28,
  borderRadius: 5,
  border: "1px solid var(--ui-border-strong)",
  background: "var(--ui-surface)",
  font: "inherit",
  fontSize: 12.5,
  color: "var(--ui-ink)",
  padding: "0 4px",
  cursor: "pointer",
};

const MARKER_GROUPS = [
  ["flow", "Flowchart"],
  ["uml", "UML"],
  ["er", "ER cardinality"],
];

function MarkerSelect({
  id,
  title,
  value,
  onChange,
}: {
  id: string;
  title: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ui-muted)" }}>
      <span style={{ width: 34 }}>{title}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
        <option value="none">None</option>
        {MARKER_GROUPS.map(([g, gl]) => (
          <optgroup key={g} label={gl}>
            {MARKER_KEYS.filter((k) => k !== "none" && MARKERS[k].group === g).map((k) => (
              <option key={k} value={k}>
                {MARKERS[k].label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

const Row = ({ children, gap = 4 }: { children: ReactNode; gap?: number }) => (
  <div style={{ display: "flex", alignItems: "center", gap }}>{children}</div>
);

// A line's text is content rather than style, so it is only offered for one
// line at a time: `text` is that line's, and null when there is not exactly
// one selected. Double-clicking the line on the canvas edits the same text.
export default function LineStyle({
  value,
  onChange,
  selectedCount,
  text = null,
  onTextChange,
}: {
  value: EdgeStyle;
  onChange: (patch: Partial<EdgeStyle>) => void;
  selectedCount: number; // lines selected on the canvas
  text?: string | null;
  onTextChange?: (text: string) => void;
}) {
  const theme = useCanvasTheme();
  const activeType = lineTypeOf(value.dash);
  const ink = inkOf(value.stroke, theme);

  return (
    <div>
      <p
        role="status"
        style={{
          margin: "2px 0 0",
          padding: "7px 9px",
          borderRadius: 6,
          fontSize: 12,
          lineHeight: 1.45,
          ...(selectedCount
            ? { background: "var(--ui-accent-soft)", color: "var(--ui-accent-ink)", fontWeight: 600 }
            : { background: "var(--ui-surface-sunken)", color: "var(--ui-muted)" }),
        }}
      >
        {selectedCount
          ? `Styling ${selectedCount} selected line${selectedCount > 1 ? "s" : ""}`
          : "Style for the next line you draw. Select lines to restyle them; double-click one to give it text."}
      </p>

      {text !== null && (
        <>
          <div style={label}>Text</div>
          <input
            id="ordo-line-text"
            type="text"
            value={text}
            placeholder="Text on the line"
            onChange={(e) => onTextChange?.(e.target.value)}
            style={{ ...selectStyle, width: "100%", boxSizing: "border-box", padding: "0 8px", cursor: "text" }}
          />
        </>
      )}

      <div style={label}>Colour</div>
      <Row gap={5}>
        {STROKE_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            title={inkOf(c, theme) === c ? c : `Ink (${c}) — follows the theme`}
            aria-label={`Stroke ${c}`}
            aria-pressed={value.stroke === c}
            onClick={() => onChange({ stroke: c })}
            style={{
              width: 22,
              height: 22,
              padding: 0,
              borderRadius: 5,
              background: inkOf(c, theme),
              cursor: "pointer",
              border: value.stroke === c ? "2px solid var(--ui-accent)" : "1px solid var(--ui-border-strong)",
              boxShadow: value.stroke === c ? "0 0 0 2px var(--ui-accent-soft)" : "none",
            }}
          />
        ))}
        <input
          id="ordo-stroke-color"
          type="color"
          title="Custom colour"
          aria-label="Custom stroke colour"
          value={value.stroke}
          onChange={(e) => onChange({ stroke: e.target.value })}
          style={{
            width: 26,
            height: 24,
            padding: 0,
            border: "1px solid var(--ui-border-strong)",
            borderRadius: 5,
            background: "var(--ui-surface)",
            cursor: "pointer",
          }}
        />
      </Row>

      <div style={label}>Weight</div>
      <Row>
        {STROKE_WEIGHTS.map((w) => (
          <button
            key={w}
            type="button"
            title={`${w}px`}
            aria-label={`Weight ${w}px`}
            aria-pressed={value.strokeWidth === w}
            onClick={() => onChange({ strokeWidth: w })}
            style={segment(value.strokeWidth === w)}
          >
            <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden>
              <path d="M2 5h18" stroke={ink} strokeWidth={w} strokeLinecap="round" />
            </svg>
          </button>
        ))}
      </Row>

      <div style={label}>Pattern</div>
      <Row>
        {LINE_TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            title={t.label}
            aria-label={t.label}
            aria-pressed={activeType === t.key}
            onClick={() => onChange({ dash: t.dash })}
            style={segment(activeType === t.key)}
          >
            <svg width="34" height="10" viewBox="0 0 34 10" aria-hidden>
              <path
                d="M2 5h30"
                stroke={ink}
                strokeWidth={Math.min(value.strokeWidth, 2)}
                strokeLinecap="round"
                {...(t.dash ? { strokeDasharray: t.dash } : {})}
              />
            </svg>
          </button>
        ))}
      </Row>

      <div style={label}>Ends</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <MarkerSelect id="ordo-marker-start" title="Start" value={value.markerStart} onChange={(markerStart) => onChange({ markerStart })} />
        <MarkerSelect id="ordo-marker-end" title="End" value={value.markerEnd} onChange={(markerEnd) => onChange({ markerEnd })} />
      </div>
    </div>
  );
}
