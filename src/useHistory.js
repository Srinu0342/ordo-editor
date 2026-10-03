import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyEdges,
  applyNodes,
  applyStep,
  createUndoStack,
  diffGraph,
} from "./history.js";

// Undo history: the React half. history.js says what a step is; this decides
// where one ends.
//
// Nothing asks for a step to be recorded. Whenever the user starts something
// new — presses a pointer, or a key outside a text field — the graph is diffed
// against the last time that happened, and whatever changed in between is one
// step: a drag with the re-parenting at its end, a paste, an import, a label
// typed out letter by letter. The writes nobody makes by hand — TubeFollower
// re-seating a rider, React Flow measuring a node — either land inside the
// window of the action that caused them or touch nothing a step records.
//
// While a pointer is held nothing closes, so a drag, a resize or a rotation is
// one step however long it runs, and a key pressed partway through (Shift, to
// snap a rotation) does not split it. Undo and redo wait for the pointer too:
// rewinding a node mid-drag would only have the drag write it straight back.

// Input types nobody types into. Every other <input> takes text.
const NOT_TEXT = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * A field that edits text owns its keys, its own undo included, and the keys
 * typed into it are one edit rather than a step each. A select or a colour well
 * is not such a field: after picking from one, the chords still reach the
 * canvas. App's chords use this too, so the two agree on what typing is.
 */
export const isTyping = (el) =>
  el instanceof HTMLElement &&
  (el.isContentEditable ||
    el.tagName === "TEXTAREA" ||
    (el.tagName === "INPUT" && !NOT_TEXT.has(el.type)));

// Each of these ends whatever pointer was held. A native drag swallows its
// pointerup, and so can a context menu; a window that loses focus may never
// hear it at all (the `blur` below).
const RELEASES = ["pointerup", "pointercancel", "dragend", "drop", "contextmenu"];

export function useHistory({ nodes, edges, setNodes, setEdges }) {
  const live = useRef(null);
  live.current = { nodes, edges };

  // The graph as of the last boundary: what the open step is diffed against.
  const baseline = useRef(live.current);
  const [stack] = useState(createUndoStack);
  const held = useRef(false);

  // Closes the open step, if anything in it changed.
  const checkpoint = useCallback(() => {
    const step = diffGraph(baseline.current, live.current);
    if (step) stack.push(step);
    baseline.current = live.current;
  }, [stack]);

  const travel = useCallback(
    (direction) => {
      if (held.current) return;

      // An edit still open is closed first. Before an undo it is what gets
      // undone; before a redo it is an override, and leaves nothing to redo.
      checkpoint();
      const step = direction === "undo" ? stack.undo() : stack.redo();
      if (!step) return;

      // Applied to the live lists rather than written over them, so the
      // selection and measured sizes stay as they are. The baseline moves with
      // them: the graph an undo lands on is not a change of its own.
      baseline.current = applyStep(baseline.current, step, direction);
      setNodes((nds) => applyNodes(nds, step, direction));
      setEdges((eds) => applyEdges(eds, step, direction));
    },
    [checkpoint, stack, setNodes, setEdges],
  );

  useEffect(() => {
    const press = (event) => {
      if (event.button === 0) held.current = true;
      if (!isTyping(event.target)) checkpoint();
    };
    const key = (event) => {
      if (!held.current && !isTyping(event.target)) checkpoint();
    };
    const release = () => {
      held.current = false;
    };

    // Capture, so the step closes before anything acts on the event.
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("keydown", key, true);
    for (const type of RELEASES) window.addEventListener(type, release, true);
    window.addEventListener("blur", release);

    return () => {
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("keydown", key, true);
      for (const type of RELEASES)
        window.removeEventListener(type, release, true);
      window.removeEventListener("blur", release);
    };
  }, [checkpoint]);

  const undo = useCallback(() => travel("undo"), [travel]);
  const redo = useCallback(() => travel("redo"), [travel]);
  return { undo, redo };
}
