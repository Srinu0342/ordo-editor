import { useEffect, useRef } from "react";
import DialogFrame, { MONO, hintStyle, primaryButton, secondaryButton } from "./DialogFrame.tsx";
import { tally } from "./diagnostics.ts";
import type { Diagnostic } from "../ordo/index.ts";
import { DIAGRAM_FILE } from "../local/api.ts";

// Every question local mode asks, in one dialog: what Sync found when both
// sides changed, a file that is gone or does not read, a canvas that cannot
// be written, and leaving a diagram with work on it that is saved nowhere. Each kind offers exactly its choices; the safe one
// is focused, so Enter never overwrites anything.

export type SyncQuestionKind =
  | "conflict"
  | "conflict-invalid"
  | "deleted"
  | "invalid"
  | "blocked"
  | "blocked-take"
  | "leave-tab";

export type SyncChoice = "keep" | "take" | "download" | "recreate" | "close-tab" | "sync" | "discard" | "ok" | "cancel";

type Option = { choice: SyncChoice; label: string; title?: string; primary?: true };

/**
 * Each kind's buttons, left to right. The last is the safe one: it takes focus
 * and Esc picks it. A primary button marks the way on that loses nothing; a
 * choice that overwrites one side or the other is never primary.
 */
export const SYNC_CHOICES: Record<SyncQuestionKind, Option[]> = {
  conflict: [
    { choice: "keep", label: "Keep mine", title: "Write the canvas over the file's changes" },
    { choice: "take", label: "Take the file's", title: "Load the file, dropping the canvas's edits" },
    { choice: "download", label: "Download mine", title: "Save the canvas as a file, and decide later" },
    { choice: "cancel", label: "Cancel" },
  ],
  "conflict-invalid": [
    { choice: "keep", label: "Keep mine", title: "Write the canvas over the broken file" },
    { choice: "download", label: "Download mine", title: "Save the canvas as a file, and decide later" },
    { choice: "cancel", label: "Cancel" },
  ],
  deleted: [
    { choice: "recreate", label: "Recreate from canvas", title: "Write the canvas back as a new file", primary: true },
    { choice: "close-tab", label: "Close tab", title: "Drop the diagram and its edits" },
    { choice: "cancel", label: "Cancel" },
  ],
  invalid: [{ choice: "ok", label: "OK", primary: true }],
  blocked: [{ choice: "ok", label: "OK", primary: true }],
  "blocked-take": [
    { choice: "take", label: "Take the file's", title: "Load the file, dropping the canvas's edits" },
    { choice: "cancel", label: "Cancel" },
  ],
  "leave-tab": [
    { choice: "sync", label: "Sync and switch", primary: true },
    { choice: "discard", label: "Discard and switch" },
    { choice: "cancel", label: "Cancel" },
  ],
};

export type SyncQuestion = {
  kind: SyncQuestionKind;
  tab?: string; // the diagram the question is about
  fileDiagnostics?: Diagnostic[]; // why the file does not read
  exportDiagnostics?: Diagnostic[]; // why the canvas cannot be written
  notice?: string; // one more sentence, such as "the file is gone too"
};

function wording({ kind, tab = "this diagram" }: SyncQuestion): { title: string; text: string } {
  const file = (name: string) => `${name}/${DIAGRAM_FILE}`;
  switch (kind) {
    case "conflict":
      return {
        title: "Both sides changed",
        text: `${file(tab)} changed on disk since your last sync, and the canvas has edits too. Ordo can't merge them: pick one.`,
      };
    case "conflict-invalid":
      return {
        title: "The file changed and doesn't read",
        text: `${file(tab)} changed on disk and is no longer valid Ordo YAML, and the canvas has edits too.`,
      };
    case "deleted":
      return {
        title: `${tab} was deleted`,
        text: `${file(tab)} is gone, removed by git or by hand. The canvas still has your edits.`,
      };
    case "invalid":
      return {
        title: "The file doesn't read",
        text: `${file(tab)} changed on disk but isn't valid Ordo YAML, so nothing was loaded. Fix it and press Sync again.`,
      };
    case "blocked":
    case "blocked-take":
      return {
        title: "The canvas can't be written",
        text: "Something on the canvas has no place in Ordo YAML, so there is nothing to sync.",
      };
    case "leave-tab":
      return { title: "Unsynced changes", text: `${tab} has edits that aren't in its file yet.` };
  }
}

export default function SyncDialog({
  question,
  onChoice,
}: {
  question: SyncQuestion;
  onChoice: (choice: SyncChoice) => void;
}) {
  const options = SYNC_CHOICES[question.kind];
  const safe = options[options.length - 1].choice;
  const safeRef = useRef<HTMLButtonElement>(null);
  const { title, text } = wording(question);

  useEffect(() => {
    const id = requestAnimationFrame(() => safeRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [question]);

  return (
    <DialogFrame
      titleId="ordo-sync-title"
      title={title}
      subtitle={text}
      icon={<SyncIcon />}
      width={560}
      onClose={() => onChoice(safe)}
      footer={
        <>
          <span style={hintStyle}>Esc to {safe === "ok" ? "close" : "cancel"}</span>
          {options.map(({ choice, label, title: hint, primary }) => (
            <button
              key={choice}
              type="button"
              title={hint}
              ref={choice === safe ? safeRef : undefined}
              onClick={() => onChoice(choice)}
              style={primary ? primaryButton(false) : secondaryButton}
            >
              {label}
            </button>
          ))}
        </>
      }
    >
      {question.notice && <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--ui-ink-2)" }}>{question.notice}</p>}
      {question.exportDiagnostics?.length ? (
        <DiagnosticList title="The canvas" items={question.exportDiagnostics} />
      ) : null}
      {question.fileDiagnostics?.length ? (
        <DiagnosticList title={question.tab ? `${question.tab}/${DIAGRAM_FILE}` : DIAGRAM_FILE} items={question.fileDiagnostics} />
      ) : null}
      {!question.notice && !question.exportDiagnostics?.length && !question.fileDiagnostics?.length && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--ui-muted)" }}>
          {question.kind === "leave-tab" ? "Sync writes them first; Discard drops them." : "Nothing changes until you choose."}
        </p>
      )}
    </DialogFrame>
  );
}

// How many problems are listed before the rest are counted.
const SHOWN = 40;

/** Problems as "ordo.yaml 6:9  message", in file order, cut off with a count. */
export function DiagnosticList({ title, items }: { title: string; items: readonly Diagnostic[] }) {
  const sorted = [...items].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  const where = (d: Diagnostic) =>
    d.line === undefined ? d.code : d.col === undefined ? String(d.line) : `${d.line}:${d.col}`;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ui-ink-2)", marginBottom: 4 }}>
        <code style={{ fontFamily: MONO }}>{title}</code>
        <span style={{ fontWeight: 400, color: "var(--ui-faint)" }}> · {tally(items)}</span>
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 2, maxHeight: 220, overflow: "auto" }}>
        {sorted.slice(0, SHOWN).map((d, i) => (
          <li key={i} style={{ display: "flex", gap: 10, fontSize: 12.5, lineHeight: 1.5, color: "var(--ui-ink)" }}>
            <code
              style={{
                fontFamily: MONO,
                minWidth: 52,
                flex: "0 0 auto",
                color: d.severity === "error" ? "var(--ui-danger)" : "var(--ui-warn)",
              }}
            >
              {where(d)}
            </code>
            <span>{d.message}</span>
          </li>
        ))}
        {sorted.length > SHOWN && (
          <li style={{ fontSize: 12.5, color: "var(--ui-muted)" }}>and {sorted.length - SHOWN} more</li>
        )}
      </ul>
    </div>
  );
}

function SyncIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M14.5 7.25A5.75 5.75 0 0 0 4.1 5.6M3.5 10.75a5.75 5.75 0 0 0 10.4 1.65"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M3.75 2.75v3h3M14.25 15.25v-3h-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
