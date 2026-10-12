import { useCallback, useRef, useState } from "react";
import type { CSSProperties } from "react";

// Double-click to edit, borderless while editing. The hidden sizer span is what
// keeps the field exactly as big as its text: a bare <textarea> carries an
// intrinsic 20 columns by 2 rows that would balloon any shrink-to-fit node, so
// the field is laid over the sizer instead and stretched to it.
//
// It is a <textarea> for every label, not only for the ones that take several
// lines: an <input> strips the line breaks out of whatever it is given, so an
// imported two-line label would lose its second line the moment anyone edited
// it. How a new line is typed is the `multiline` choice. A text node, which is
// all text, takes Enter as a new line and finishes on Escape, Cmd/Ctrl+Enter or
// a click away; every other label finishes on Enter and takes Shift+Enter.
//
// Whether it is editing is its own business unless the owner passes `editing`:
// an edge does, so that a double-click anywhere on the line can open it, and so
// does a text node, which opens itself when it is dropped or Enter is pressed.
// Opened that way the text is all selected, so typing replaces it; opened by a
// double-click, the caret lands where the pointer was.
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
  multiline = false,
}: {
  value: string;
  onChange: (value: string) => void;
  style?: CSSProperties;
  placeholder?: string;
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  grab?: boolean;
  multiline?: boolean;
}) {
  const [editingOwn, setEditingOwn] = useState(false);
  const editing = editingProp ?? editingOwn;
  // Whether the field is up, as of the last event rather than the last render:
  // Escape closes it and the blur that follows must not close it a second time.
  const open = useRef(false);
  const setEditing = (next: boolean) => {
    if (open.current === next) return;
    open.current = next;
    setEditingOwn(next);
    onEditingChange?.(next);
  };

  // Where the caret goes when the field mounts: an offset into the text, or
  // null to select all of it.
  const caret = useRef<number | null>(null);
  const shownRef = useRef<HTMLSpanElement>(null);

  // Also closes `open` when the field goes, so an owner that shuts it from
  // outside leaves nothing behind to swallow the next double-click.
  //
  // A node just dropped is hidden until React Flow has measured it, and a
  // hidden field cannot take focus, so focus is tried again each frame until
  // it lands. The canvas pane clips rather than scrolls; scrolling the field
  // into view would shift the whole viewport under the pointer.
  const focusOnMount = useCallback((el: HTMLTextAreaElement | null) => {
    open.current = !!el;
    if (!el) return;
    const at = caret.current;
    caret.current = null;
    let frames = 0;
    const settle = () => {
      if (!el.isConnected) return;
      el.focus({ preventScroll: true });
      if (document.activeElement !== el) {
        if (++frames < 30) requestAnimationFrame(settle);
        return;
      }
      if (at === null) el.select();
      else el.setSelectionRange(at, at);
    };
    settle();
  }, []);

  // Both modes render into the same grid cell with the same metrics, so
  // entering edit mode can't shift the layout. paddingRight is caret room.
  const cell: CSSProperties = {
    gridArea: "1 / 1",
    whiteSpace: "pre",
    paddingRight: 2,
  };
  const shown = value || "";
  const held = editing || !grab;
  // A line break at the very end makes a line, but an empty last line has no
  // height of its own; the space gives the sizer one, so the caret has room.
  const sizer = (shown || placeholder || " ") + (shown.endsWith("\n") ? " " : "");

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
        if (editing) return; // a double-click inside the field selects a word
        caret.current = shownRef.current
          ? caretAt(e.clientX, e.clientY, shownRef.current)
          : null;
        setEditing(true);
      }}
    >
      <span aria-hidden style={{ ...cell, visibility: "hidden" }}>
        {sizer}
      </span>
      {editing ? (
        <textarea
          ref={focusOnMount}
          rows={1}
          cols={1}
          wrap="off"
          value={shown}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            e.stopPropagation();
            // Enter while an IME is composing picks a candidate; it is not ours.
            if (e.nativeEvent.isComposing) return;
            const done =
              e.key === "Escape" ||
              (e.key === "Enter" &&
                (multiline ? e.metaKey || e.ctrlKey : !e.shiftKey));
            if (done) {
              e.preventDefault();
              setEditing(false);
            }
          }}
          style={{
            ...cell,
            display: "block",
            width: "100%",
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            font: "inherit",
            color: "inherit",
            textAlign: "inherit",
            border: "none",
            outline: "none",
            background: "transparent",
            padding: 0,
            margin: 0,
            resize: "none",
            overflow: "hidden",
          }}
        />
      ) : (
        <span ref={shownRef} style={{ ...cell, opacity: shown ? 1 : 0.45 }}>
          {shown || placeholder}
        </span>
      )}
    </div>
  );
}

// The offset into `within`'s text under a point, or null when the point is not
// on its text (the placeholder, or a browser that cannot say). The span and
// the field lay their text out identically, so the offset carries across.
function caretAt(x: number, y: number, within: HTMLElement): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => {
      offsetNode: Node;
      offset: number;
    } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | undefined;
  let offset = 0;
  if (doc.caretPositionFromPoint) {
    const at = doc.caretPositionFromPoint(x, y);
    node = at?.offsetNode;
    offset = at?.offset ?? 0;
  } else if (doc.caretRangeFromPoint) {
    const at = doc.caretRangeFromPoint(x, y);
    node = at?.startContainer;
    offset = at?.startOffset ?? 0;
  }
  return node && node.nodeType === Node.TEXT_NODE && within.contains(node)
    ? offset
    : null;
}
