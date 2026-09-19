import { useCallback, useState } from "react";

// Double-click to edit, borderless while editing. The hidden sizer span is what
// keeps the input exactly as wide as its text — a bare <input> carries an
// intrinsic ~20ch width that would balloon any shrink-to-fit node.
export default function EditableLabel({ value, onChange, style, placeholder }) {
  const [editing, setEditing] = useState(false);
  const focusOnMount = useCallback((el) => el?.focus(), []);

  // Both modes render into the same grid cell with the same metrics, so
  // entering edit mode can't shift the layout. paddingRight is caret room.
  const cell = { gridArea: "1 / 1", whiteSpace: "pre", paddingRight: 2 };
  const shown = value || "";

  return (
    <div
      className="nodrag nopan"
      style={{
        ...style,
        display: "inline-grid",
        cursor: "text",
        pointerEvents: "all",
        maxWidth: "100%",
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      <span style={{ ...cell, visibility: "hidden" }}>
        {shown || placeholder || " "}
      </span>
      {editing ? (
        <input
          ref={focusOnMount}
          type="text"
          size={1}
          value={shown}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") setEditing(false);
            e.stopPropagation();
          }}
          style={{
            ...cell,
            width: "100%",
            minWidth: 0,
            boxSizing: "border-box",
            font: "inherit",
            color: "inherit",
            textAlign: "inherit",
            border: "none",
            outline: "none",
            background: "transparent",
            padding: 0,
            margin: 0,
          }}
        />
      ) : (
        <span style={{ ...cell, opacity: shown ? 1 : 0.45 }}>
          {shown || placeholder}
        </span>
      )}
    </div>
  );
}
