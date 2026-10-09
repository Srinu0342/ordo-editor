import type { Edge, Node } from "@xyflow/react";
import type { Document } from "yaml";
import { detectStyle, joinDocuments, readBundle, readLayout, resolve, type ReadResult, type YamlStyle } from "./read.ts";
import { toReactFlow } from "./to-react-flow.ts";
import { fromReactFlow } from "./from-react-flow.ts";
import { writeLayout, writeOrdo } from "./write.ts";
import { shapeVocabulary } from "./rf-mapping.ts";
import type { OrdoEdge, OrdoNode } from "../types.ts";
import type { Diagnostic, OrdoFile, OrdoLayoutFile, ResolvedDiagram } from "./types.ts";

// The Ordo pipeline end to end, for the editor's two dialogs.
//
// A diagram is one file, <name>.yaml, holding two YAML documents: the
// structure and content (`ordo: 1`), then `---`, then the geometry
// (`ordo-layout: 1`). They stay separate documents so that a drag only ever
// changes lines in the second one and a rename only lines in the first, and
// so the layout can be left out: a file with only the structure is laid out
// on import, and gains its layout on the next export.
//
//   Import  Ordo YAML   text -> read.ts (parse, validate) -> resolve -> to-react-flow
//   View Ordo YAML     canvas -> from-react-flow -> write.ts (patch the session) -> text
//
// The yaml Documents are the hinge between the two. An import keeps them in
// the session; each export patches clones of them rather than regenerating
// the files, and on success the patched documents replace them. That is how
// comments, ordering and blank lines survive canvas edits, and why exporting
// the same canvas twice is byte-identical.

export * from "./types.ts";
export { detectKind, detectStyle } from "./read.ts";
export type { YamlStyle } from "./read.ts";
export { mintId, idMinter } from "./ids.ts";

export const DEFAULT_NAME = "diagram";

/** Kept next to the React Flow state. Any other way of replacing the canvas sets both documents to null. */
export interface OrdoSession {
  name: string; // the file is <name>.yaml; default "diagram"
  ordo: Document | null; // baseline from the last Ordo import or export
  layout: Document | null;
  style?: YamlStyle; // the imported file's indentation, which the writer keeps
}

export const emptySession = (name = DEFAULT_NAME): OrdoSession => ({ name, ordo: null, layout: null });

const isError = (d: Diagnostic) => d.severity === "error";

/** Both documents read and validated, structure first: the layout validator needs its ids. */
export type OrdoRead = {
  ordo: ReadResult<OrdoFile> | null; // null when there is no structure document
  layout: ReadResult<OrdoLayoutFile> | null; // null when there is no layout
  diagnostics: Diagnostic[];
  ok: boolean; // no errors anywhere
};

/**
 * Read a diagram's file. A layout kept in a file of its own (the older
 * two-file form) can be passed as `layoutText`.
 */
export function readDiagram(text: string, layoutText?: string | null): OrdoRead {
  const bundle = readBundle(text, shapeVocabulary());
  let layout = bundle.layout;
  const diagnostics = [...bundle.diagnostics, ...(bundle.ordo?.diagnostics ?? []), ...(layout?.diagnostics ?? [])];
  if (layoutText?.trim()) {
    if (layout)
      diagnostics.push({
        severity: "error",
        code: "schema",
        message: "the diagram already holds a layout document; give only one",
        file: "layout",
      });
    else {
      layout = readLayout(layoutText, bundle.ordo?.value ?? null);
      diagnostics.push(...layout.diagnostics);
    }
  }
  const ok = !diagnostics.some(isError) && bundle.ordo?.value != null && (layout === null || layout.value !== null);
  return { ordo: bundle.ordo, layout, diagnostics, ok };
}

export type OrdoImport = {
  nodes: OrdoNode[]; // empty when there is any error
  edges: OrdoEdge[];
  ordo: Document | null; // the documents for the session; null when there is any error
  layout: Document | null;
  style: YamlStyle; // how the text indents, for the session
  diagnostics: Diagnostic[];
};

/** Read a diagram's two files (the layout is optional) and project them onto the canvas. */
export function importOrdo(ordoText: string, layoutText?: string | null): OrdoImport {
  const read = readDiagram(ordoText, layoutText);
  const style = detectStyle(ordoText);
  if (!read.ok || !read.ordo?.value)
    return { nodes: [], edges: [], ordo: null, layout: null, style, diagnostics: read.diagnostics };
  const { nodes, edges } = toReactFlow(resolve(read.ordo.value), read.layout?.value ?? null);
  return { nodes, edges, ordo: read.ordo.doc, layout: read.layout?.doc ?? null, style, diagnostics: read.diagnostics };
}

export type OrdoExport = {
  diagnostics: Diagnostic[]; // any error means nothing was written
  text: string | null; // the one file: structure, ---, layout
  ordo: { doc: Document; text: string } | null; // null when there is any error
  layout: { doc: Document; text: string } | null;
};

/**
 * Write the canvas as the two files, patching the session's documents when it
 * has them. On success the caller stores the returned documents as the new
 * session baseline.
 */
export function exportOrdo(nodes: Node[], edges: Edge[], session: OrdoSession | null): OrdoExport {
  const { diagram, layout, diagnostics } = fromReactFlow(nodes, edges);
  const refuse = (more: Diagnostic[] = []): OrdoExport => ({
    diagnostics: [...diagnostics, ...more],
    text: null,
    ordo: null,
    layout: null,
  });
  if (diagnostics.some(isError)) return refuse();

  const ordo = writeOrdo(session?.ordo ?? null, diagram, session?.style);
  const written = writeLayout(session?.layout ?? null, layout, session?.style);

  // fromReactFlow proved the canvas survives the model; this proves the model
  // survives the text, so a fault in the patching can never reach a file.
  const text = joinDocuments(ordo.text, written.text);
  const unread = readBack(text, diagram, layout);
  if (unread.length) return refuse(unread);

  return { diagnostics, text, ordo, layout: written };
}

/** `checkout.yml`, `checkout.yaml`, `checkout.layout.yml` and `checkout.layout.yaml` all name the diagram `checkout`. */
export function diagramName(fileName: string | null | undefined, fallback = DEFAULT_NAME): string {
  const base = String(fileName ?? "").split(/[\\/]/).pop() ?? "";
  const name = base.replace(/(\.layout)?\.ya?ml$/i, "");
  return name.trim() || fallback;
}

/** The file a diagram is written to. */
export const fileName = (name: string) => `${name}.yaml`;

// ---------------------------------------------------------------------------

const lossy = (message: string): Diagnostic => ({ severity: "error", code: "canvas-lossy", message, file: "canvas" });

function readBack(text: string, diagram: ResolvedDiagram, layout: OrdoLayoutFile): Diagnostic[] {
  const read = readDiagram(text);
  const problem = read.diagnostics[0];
  if (!read.ok || !read.ordo?.value || !read.layout?.value || problem)
    return [lossy(`the written files do not read back cleanly: ${problem?.message ?? "unknown error"}`)];

  const out: Diagnostic[] = [];
  const fields = (o: object) =>
    JSON.stringify(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  // Sibling order carries no meaning in v1 (the writer keeps the file's own
  // order and appends), so the comparison is by id.
  const compare = (kind: string, want: { id: string }[], got: { id: string }[]) => {
    const found = new Map(got.map((x) => [x.id, fields(x)]));
    const wanted = new Set(want.map((x) => x.id));
    for (const x of want)
      if (found.get(x.id) !== fields(x)) out.push(lossy(`${kind} "${x.id}" does not read back as written`));
    for (const id of found.keys())
      if (!wanted.has(id)) out.push(lossy(`${kind} "${id}" is in the written file but not on the canvas`));
  };
  const back = resolve(read.ordo.value);
  compare("node", diagram.nodes, back.nodes);
  compare("edge", diagram.edges, back.edges);
  const entries = (m: Record<string, object> | undefined) => Object.entries(m ?? {}).map(([id, v]) => ({ id, ...v }));
  compare("layout of node", entries(layout.nodes), entries(read.layout.value.nodes));
  compare("layout of edge", entries(layout.edges), entries(read.layout.value.edges));
  return out;
}
