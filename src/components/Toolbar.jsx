import {
  STROKE_SWATCHES,
  STROKE_WEIGHTS,
  LINE_TYPES,
  lineTypeOf,
} from "../edgeStyle.js";
import { MARKERS, MARKER_KEYS } from "../edges/index.js";

const MOD = navigator.platform.startsWith("Mac") ? "\u2318" : "Ctrl";

// Line appearance. Edits land on the current edge selection when there is one,
// and otherwise become the default for the next edge drawn — the behaviour
// every drawing tool has, and the reason the strip reports which it will do.

const groupStyle = { display: "flex", alignItems: "center", gap: 4 };

const divider = (
  <div
    style={{ width: 1, height: 22, background: "#e2e8f0", margin: "0 6px" }}
  />
);

const selectStyle = {
  height: 28,
  borderRadius: 6,
  border: "1px solid #cbd5e1",
  background: "#fff",
  font: "inherit",
  fontSize: 12.5,
  color: "#0f172a",
  padding: "0 6px",
  cursor: "pointer",
  maxWidth: 148,
};

const MARKER_GROUPS = [
  ["flow", "Flowchart"],
  ["uml", "UML"],
  ["er", "ER cardinality"],
];

function MarkerSelect({ id, title, value, onChange }) {
  return (
    <label style={{ ...groupStyle, color: "#64748b", fontSize: 12.5 }}>
      {title}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={selectStyle}
      >
        <option value="none">None</option>
        {MARKER_GROUPS.map(([g, gl]) => (
          <optgroup key={g} label={gl}>
            {MARKER_KEYS.filter(
              (k) => k !== "none" && MARKERS[k].group === g,
            ).map((k) => (
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

// The selection chip doubles as the only place the multi-select and clipboard
// chords are written down — shortcuts nobody can see are shortcuts nobody uses.
const SHORTCUTS = [
  "Shift-drag: lasso",
  `${MOD}-click: add to selection`,
  `${MOD}+A: select all`,
  `${MOD}+C / ${MOD}+X / ${MOD}+V: copy, cut, paste`,
  `${MOD}+D: duplicate`,
].join("\n");

export default function Toolbar({
  value,
  onChange,
  selectedCount,
  selectedNodeCount = 0,
  onImport,
}) {
  const activeType = lineTypeOf(value.dash);
  const picked = [
    selectedNodeCount &&
      `${selectedNodeCount} node${selectedNodeCount > 1 ? "s" : ""}`,
    selectedCount && `${selectedCount} line${selectedCount > 1 ? "s" : ""}`,
  ].filter(Boolean);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: "8px 12px",
        borderBottom: "1px solid #e2e8f0",
        background: "#fff",
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        flexWrap: "wrap",
      }}
    >
      <span style={{ color: "#64748b", marginRight: 8 }}>Line</span>

      <div style={groupStyle}>
        {STROKE_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            aria-label={`Stroke ${c}`}
            aria-pressed={value.stroke === c}
            onClick={() => onChange({ stroke: c })}
            style={{
              width: 22,
              height: 22,
              borderRadius: 5,
              background: c,
              cursor: "pointer",
              border:
                value.stroke === c ? "2px solid #6366f1" : "1px solid #cbd5e1",
              boxShadow: value.stroke === c ? "0 0 0 2px #eef2ff" : "none",
            }}
          />
        ))}
        <input
          id="ordo-stroke-color"
          type="color"
          aria-label="Custom stroke colour"
          value={value.stroke}
          onChange={(e) => onChange({ stroke: e.target.value })}
          style={{
            width: 26,
            height: 24,
            padding: 0,
            border: "1px solid #cbd5e1",
            borderRadius: 5,
            background: "#fff",
            cursor: "pointer",
          }}
        />
      </div>

      {divider}

      <label style={{ ...groupStyle, color: "#64748b" }}>
        Weight
        <select
          id="ordo-stroke-width"
          value={value.strokeWidth}
          onChange={(e) => onChange({ strokeWidth: Number(e.target.value) })}
          style={selectStyle}
        >
          {STROKE_WEIGHTS.map((w) => (
            <option key={w} value={w}>
              {w}px
            </option>
          ))}
        </select>
      </label>

      {divider}

      <div style={groupStyle}>
        {LINE_TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            title={t.label}
            aria-label={t.label}
            aria-pressed={activeType === t.key}
            onClick={() => onChange({ dash: t.dash })}
            style={{
              height: 28,
              padding: "0 8px",
              display: "grid",
              placeItems: "center",
              borderRadius: 6,
              cursor: "pointer",
              border:
                activeType === t.key
                  ? "1px solid #6366f1"
                  : "1px solid #cbd5e1",
              background: activeType === t.key ? "#eef2ff" : "#fff",
            }}
          >
            <svg width="30" height="10" viewBox="0 0 30 10">
              <path
                d="M1 5h28"
                stroke={value.stroke}
                strokeWidth={value.strokeWidth}
                strokeLinecap="round"
                {...(t.dash ? { strokeDasharray: t.dash } : {})}
              />
            </svg>
          </button>
        ))}
      </div>

      {divider}

      <MarkerSelect
        id="ordo-marker-start"
        title="Start"
        value={value.markerStart}
        onChange={(markerStart) => onChange({ markerStart })}
      />
      <MarkerSelect
        id="ordo-marker-end"
        title="End"
        value={value.markerEnd}
        onChange={(markerEnd) => onChange({ markerEnd })}
      />

      <span
        title={SHORTCUTS}
        style={{
          marginLeft: "auto",
          fontSize: 12.5,
          color: picked.length ? "#4f46e5" : "#94a3b8",
          cursor: "help",
          whiteSpace: "nowrap",
        }}
      >
        {picked.length ? `${picked.join(" · ")} selected` : "Nothing selected"}
      </span>

      <button
        type="button"
        onClick={onImport}
        title="Import a Mermaid diagram"
        style={{
          marginLeft: 10,
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          height: 28,
          padding: "0 11px",
          borderRadius: 6,
          border: "1px solid #cbd5e1",
          background: "#f8fafc",
          font: "inherit",
          fontSize: 12.5,
          color: "#334155",
          cursor: "pointer",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
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
        Import Mermaid
      </button>
    </div>
  );
}
