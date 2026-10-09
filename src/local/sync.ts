// What Sync does, decided from two facts and nothing else: has the canvas
// changed since the base, and has the file? The base is the file's ETag and
// the canvas's own export, both as of the last load or write. Comparing the
// canvas with its own export rather than with the file's text is what keeps a
// freshly opened diagram from looking unsynced: the writer may reformat a
// file it did not write (a missing layout document, other whitespace), but
// it always writes an untouched canvas the same way twice.
//
// There is no merge. When both sides changed, the person picks one.

export type CanvasState = "unchanged" | "changed" | "unexportable";
export type FileState = "same" | "changed" | "changed-invalid" | "deleted";

export type SyncAction =
  | "nothing" // both as they were: "Up to date"
  | "write" // only the canvas changed: PUT with the base ETag
  | "load" // only the file changed: import it, one undo step
  | "show-invalid" // only the file changed, and it does not read: show why
  | "close" // the file is gone and the canvas has nothing to lose: drop the tab
  | "conflict" // both changed: Keep mine, Take the file's, Download mine
  | "conflict-invalid" // both changed, and the file does not read: Keep mine, Download mine
  | "deleted" // the file is gone, the canvas has edits: Recreate, or Close the tab
  | "blocked" // the canvas cannot be written: show why
  | "blocked-take"; // the canvas cannot be written, but the file can be taken

const TABLE: Record<CanvasState, Record<FileState, SyncAction>> = {
  unchanged: { same: "nothing", changed: "load", "changed-invalid": "show-invalid", deleted: "close" },
  changed: { same: "write", changed: "conflict", "changed-invalid": "conflict-invalid", deleted: "deleted" },
  unexportable: { same: "blocked", changed: "blocked-take", "changed-invalid": "blocked", deleted: "blocked" },
};

export const decideSync = (canvas: CanvasState, file: FileState): SyncAction => TABLE[canvas][file];

/** "unexportable" when the export was refused (null); otherwise whether it differs from the base export. */
export function canvasState(exported: string | null, baseExported: string): CanvasState {
  if (exported === null) return "unexportable";
  return exported === baseExported ? "unchanged" : "changed";
}
