import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode, RefObject } from "react";

// A header button that drops a small panel under it: the Import menu and the
// shortcuts card. It closes on Esc (focus goes back to the button), on a press
// anywhere outside it, and when an item calls `close`. A menu puts focus on
// its first item as it opens, so the arrows and Enter work at once.

export default function Popover({
  label,
  button,
  buttonStyle,
  buttonClassName,
  buttonRef,
  role = "menu",
  align = "end",
  width = 240,
  children,
}: {
  label: string; // the button's accessible name and tooltip
  button: ReactNode; // what the button shows
  buttonStyle: CSSProperties;
  buttonClassName?: string;
  // A dialog opened from the panel hands focus back here when it closes.
  buttonRef?: RefObject<HTMLButtonElement | null>;
  role?: "menu" | "dialog";
  align?: "start" | "end"; // which edge of the button the panel lines up with
  width?: number;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ownRef = useRef<HTMLButtonElement>(null);
  const trigger = buttonRef ?? ownRef;
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || trigger.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    if (role === "menu") items(panelRef.current)[0]?.focus();
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, role, trigger]);

  const close = () => setOpen(false);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      trigger.current?.focus();
      return;
    }
    if (role !== "menu") return;
    if (event.key === "Tab") return close();
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const list = items(panelRef.current);
    const at = list.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    list[(at + step + list.length) % list.length]?.focus();
  };

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={trigger}
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup={role === "menu" ? "menu" : "dialog"}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={buttonClassName}
        style={{
          ...buttonStyle,
          ...(open ? { background: "var(--ui-accent-soft)", color: "var(--ui-accent-ink)" } : {}),
        }}
      >
        {button}
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role={role}
          aria-label={label}
          onKeyDown={onKeyDown}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            ...(align === "end" ? { right: 0 } : { left: 0 }),
            zIndex: 1000,
            width,
            padding: 6,
            borderRadius: 10,
            border: "1px solid var(--ui-border)",
            background: "var(--ui-surface)",
            boxShadow: "var(--ui-shadow-dialog)",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

const items = (panel: HTMLElement | null) => [...(panel?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

/** One row of a menu: an icon, a name, and a line saying what it does. */
export function MenuItem({
  icon,
  title,
  hint,
  onSelect,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="ordo-menu-item"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        width: "100%",
        padding: "8px 10px",
        border: "none",
        borderRadius: 7,
        background: "transparent",
        color: "var(--ui-ink)",
        font: "inherit",
        fontSize: 13,
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span style={{ display: "inline-flex", marginTop: 1, color: "var(--ui-muted)" }}>{icon}</span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontWeight: 500 }}>{title}</span>
        <span style={{ fontSize: 11.5, color: "var(--ui-muted)", lineHeight: 1.4 }}>{hint}</span>
      </span>
    </button>
  );
}
