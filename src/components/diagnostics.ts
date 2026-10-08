import { detectKind } from "../ordo/index.ts";
import type { Diagnostic } from "../ordo/index.ts";

// What the two .ordo dialogs make of text and diagnostics, without React: which
// box a dropped file belongs in, where a diagnostic points, and how a long run
// of them is grouped so that it stays readable.

/** A file's name and text, once it has been read. */
export type LoadedFile = { name: string; text: string };

/** Which box each dropped file goes into, decided by what it holds. */
export type RoutedFiles = {
  ordo?: LoadedFile;
  layout?: LoadedFile;
  problems: string[]; // one sentence per file that went into neither box
};

/**
 * Sort dropped or chosen files into the structure and layout boxes by their
 * version key (`ordo: 1` or `ordo-layout: 1`), never by their names: a layout
 * saved as notes.txt still lands in the layout box. A file that is neither is
 * turned away by name, and so is a second file of a kind already taken.
 */
export function routeFiles(files: readonly LoadedFile[]): RoutedFiles {
  const out: RoutedFiles = { problems: [] };
  for (const file of files) {
    const kind = detectKind(file.text);
    if (kind === null) {
      out.problems.push(`${file.name} is not an .ordo file: it has no "ordo: 1" or "ordo-layout: 1" line.`);
      continue;
    }
    const kept = out[kind];
    if (kept) {
      const what = kind === "ordo" ? "structure" : "layout";
      out.problems.push(`${file.name} is a second ${what} file; kept ${kept.name}.`);
      continue;
    }
    out[kind] = file;
  }
  return out;
}

/** "checkout.ordo 6:9": the file a diagnostic is in and where, or just the file when it has no position. */
export function locationOf(d: Diagnostic, fileLabel: (file: Diagnostic["file"]) => string): string {
  const file = fileLabel(d.file);
  if (d.line === undefined) return file;
  return d.col === undefined ? `${file} ${d.line}` : `${file} ${d.line}:${d.col}`;
}

/**
 * The character range of 1-based `line` in `text`, newline excluded, so a
 * textarea can select it. A line past the end selects the end of the text.
 */
export function lineSpan(text: string, line: number): [start: number, end: number] {
  let start = 0;
  for (let n = 1; n < line; n++) {
    const next = text.indexOf("\n", start);
    if (next < 0) return [text.length, text.length];
    start = next + 1;
  }
  const end = text.indexOf("\n", start);
  return [start, end < 0 ? text.length : end];
}

export type DiagnosticGroup = {
  code: Diagnostic["code"];
  severity: Diagnostic["severity"]; // "error" when any diagnostic in it is one
  items: Diagnostic[];
};

/**
 * Diagnostics grouped by code, so that a canvas refusing hundreds of nodes for
 * the same reason reads as one line with a count. Groups holding an error come
 * first; within each severity, groups and the diagnostics inside them keep the
 * order they were reported in.
 */
export function groupDiagnostics(diagnostics: readonly Diagnostic[]): DiagnosticGroup[] {
  const groups = new Map<string, DiagnosticGroup>();
  for (const d of diagnostics) {
    const group = groups.get(d.code);
    if (!group) groups.set(d.code, { code: d.code, severity: d.severity, items: [d] });
    else {
      group.items.push(d);
      if (d.severity === "error") group.severity = "error";
    }
  }
  const all = [...groups.values()];
  return [...all.filter((g) => g.severity === "error"), ...all.filter((g) => g.severity !== "error")];
}

/** "3 errors", "1 warning": a count with its noun. */
export const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** "5 errors, 1 warning", or "" when there is nothing to report. */
export function tally(diagnostics: readonly Diagnostic[]): string {
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.length - errors;
  return [errors ? plural(errors, "error") : "", warnings ? plural(warnings, "warning") : ""]
    .filter(Boolean)
    .join(", ");
}
