import { useCallback, useState } from "react";
import type { CSSProperties } from "react";

// Double-click to edit, borderless while editing. The hidden sizer span is what
// keeps the input exactly as wide as its text — a bare <input> carries an
// intrinsic ~20ch width that would balloon any shrink-to-fit node.
//
// Whether it is editing is its own business unless the owner passes `editing`:
// an edge does, so that a double-click anywhere on the line can open it.
// `grab` is for text that IS its node (a text node): until a double-click
// starts an edit, pressing on the text drags the node instead of being kept
// for the caret.
export default function EditableLabel({
  value,
  onChange,
  style,
  placeholder,
  editing: editingProp,
  onEditingChange,
  grab = false,
}: {
  value: string;
  onChange: (value: string) => void;
  style?: CSSProperties;
  placeholder?: string;
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  grab?: boolean;
}) {
  const [editingOwn, setEditingOwn] = useState(false);
  const editing = editingProp ?? editingOwn;
  const setEditing = (next: boolean) => {
    setEditingOwn(next);
    onEditingChange?.(next);
  };
  const focusOnMount = useCallback(
    (el: HTMLInputElement | null) => el?.focus(),
    [],
  );

  // Both modes render into the same grid cell with the same metrics, so
  // entering edit mode can't shift the layout. paddingRight is caret room.
  const cell: CSSProperties = {
    gridArea: "1 / 1",
    whiteSpace: "pre",
    paddingRight: 2,
  };
  const shown = value || "";
  const held = editing || !grab;

  return (
    <div
      className={held ? "nodrag nopan" : undefined}
      style={{
        ...style,
        display: "inline-grid",
        cursor: held ? "text" : undefined,
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
