import { Document, isMap, LineCounter, parseAllDocuments, parseDocument } from "yaml";
import { validateLayout, validateOrdo } from "./validate.ts";
import { canonicalShape } from "./rf-mapping.ts";
import {
  DEFAULTS,
  KIND_FIELDS,
  LABELLED,
  lineWidth,
  type Diagnostic,
  type OrdoFile,
  type OrdoKind,
  type OrdoLayoutFile,
  type OrdoNodeData,
  type OrdoSkeletonItem,
  type ResolvedDiagram,
  type ResolvedEdge,
  type ResolvedNode,
} from "./types.ts";

// Reading a file returns three things: the parsed yaml Document, the typed
// value (null on any error), and the diagnostics. The Document is the part
// most implementations throw away, and it must be kept: export patches it,
// which is how comments and ordering survive (see write.ts).
//
// Files are YAML 1.2, read only with the `yaml` package, so `yes`, `no` and
// `on` stay strings. js-yaml must not appear anywhere in this pipeline: in the
// spike it kept none of a file's comments.

export interface ReadResult<T> {
  doc: Document; // keep it: export patches this document so comments and order survive
  value: T | null; // null when there is any error
  diagnostics: Diagnostic[];
}

const PARSE_OPTIONS = { version: "1.2", uniqueKeys: true, prettyErrors: true } as const;

// prettyErrors appends the position to the message ("... at line 3, column 1:")
// and then the source excerpt; both are already carried as line and col.
const POSITION = / at line \d+, column \d+:?$/;

/** A document's YAML errors and warnings, as diagnostics. */
function syntax(doc: Document, file: "ordo" | "layout"): Diagnostic[] {
  return [...doc.errors, ...doc.warnings].map((e) => ({
    severity: doc.errors.includes(e) ? "error" : "warning",
    code: "yaml-syntax",
    message: e.message.split("\n")[0].replace(POSITION, ""),
    file,
    line: e.linePos?.[0].line,
    col: e.linePos?.[0].col,
  }));
}

const hasErrors = (d: Diagnostic[]) => d.some((x) => x.severity === "error");

function parse(text: string) {
  const lc = new LineCounter();
  const doc = parseDocument(text, { ...PARSE_OPTIONS, lineCounter: lc });
  return { doc, lc };
}

function readOrdoDoc(doc: Document, lc: LineCounter, shapes: ReadonlySet<string>): ReadResult<OrdoFile> {
  const diagnostics = syntax(doc, "ordo");
  if (hasErrors(diagnostics)) return { doc, value: null, diagnostics };
  const value = doc.toJS();
  diagnostics.push(...validateOrdo(value, doc, lc, shapes));
  return { doc, value: hasErrors(diagnostics) ? null : (value as OrdoFile), diagnostics };
}

function readLayoutDoc(doc: Document, lc: LineCounter, ordo: OrdoFile | null): ReadResult<OrdoLayoutFile> {
  const diagnostics = syntax(doc, "layout");
  if (hasErrors(diagnostics)) return { doc, value: null, diagnostics };
  const value = doc.toJS();
  diagnostics.push(...validateLayout(value, doc, lc, ordo));
  return { doc, value: hasErrors(diagnostics) ? null : (value as OrdoLayoutFile), diagnostics };
}

/** Read the structure first: the layout validator needs its node and edge ids to flag orphans. */
export function readOrdo(text: string, shapes: ReadonlySet<string>): ReadResult<OrdoFile> {
  const { doc, lc } = parse(text);
  return readOrdoDoc(doc, lc, shapes);
}

export function readLayout(text: string, ordo: OrdoFile | null): ReadResult<OrdoLayoutFile> {
  const { doc, lc } = parse(text);
  return readLayoutDoc(doc, lc, ordo);
}

/** Which of the two documents `doc` is, by its version key. */
function kindOf(doc: Document): "ordo" | "layout" | null {
  if (!isMap(doc.contents)) return null;
  if (doc.contents.has("ordo")) return "ordo";
  if (doc.contents.has("ordo-layout")) return "layout";
  return null;
}

/**
 * File kind comes from the version key, never from the filename. A file
 * holding both documents is an "ordo" file.
 */
export function detectKind(text: string): "ordo" | "layout" | null {
  const kinds = parseAllDocuments(text, PARSE_OPTIONS);
  if (!Array.isArray(kinds)) return null;
  const found = kinds.map(kindOf);
  return found.includes("ordo") ? "ordo" : found.includes("layout") ? "layout" : null;
}

export interface BundleRead {
  ordo: ReadResult<OrdoFile> | null; // null when the text has no structure document
  layout: ReadResult<OrdoLayoutFile> | null; // null when it has no layout document
  diagnostics: Diagnostic[]; // about the file as a whole: a missing, extra or unknown document
}

/**
 * Read a diagram's one file: the structure document (`ordo: 1`), and
 * optionally, after a `---`, the layout document (`ordo-layout: 1`). Either
 * order reads; the structure is validated first, because the layout's check
 * needs its ids. Line numbers count from the top of the file.
 */
export function readBundle(text: string, shapes: ReadonlySet<string>): BundleRead {
  const lc = new LineCounter();
  const parsed = parseAllDocuments(text, { ...PARSE_OPTIONS, lineCounter: lc });
  const docs: Document[] = Array.isArray(parsed) ? parsed : [];
  const at = (doc: Document) => {
    const r = (doc.contents as { range?: [number, number, number] } | null)?.range;
    return r ? lc.linePos(r[0]) : { line: 1, col: 1 };
  };
  const problem = (doc: Document | null, file: "ordo" | "layout", message: string): Diagnostic => ({
    severity: "error",
    code: "schema",
    message,
    file,
    ...(doc ? at(doc) : { line: 1, col: 1 }),
  });

  const diagnostics: Diagnostic[] = [];
  let ordoDoc: Document | null = null;
  let layoutDoc: Document | null = null;
  docs.forEach((doc, i) => {
    const kind = kindOf(doc);
    if (kind === "ordo") {
      if (ordoDoc) diagnostics.push(problem(doc, "ordo", "a second structure document (ordo: 1); a file holds one diagram"));
      else ordoDoc = doc;
    } else if (kind === "layout") {
      if (layoutDoc) diagnostics.push(problem(doc, "layout", "a second layout document (ordo-layout: 1)"));
      else layoutDoc = doc;
    } else if (!hasErrors(syntax(doc, "ordo")))
      diagnostics.push(problem(doc, "ordo", `document ${i + 1} is neither the structure (ordo: 1) nor the layout (ordo-layout: 1)`));
    else diagnostics.push(...syntax(doc, "ordo"));
  });
  if (!ordoDoc && !diagnostics.some((d) => d.code === "yaml-syntax"))
    diagnostics.push(problem(null, "ordo", "no structure document: the file needs the part that starts ordo: 1"));

  const ordo = ordoDoc ? readOrdoDoc(ordoDoc, lc, shapes) : null;
  const layout = layoutDoc ? readLayoutDoc(layoutDoc, lc, ordo?.value ?? null) : null;
  return { ordo, layout, diagnostics };
}

/** How a file indents: what the writer is handed so a save keeps it. */
export type YamlStyle = { indent: number; indentSeq: boolean };

const DEFAULT_STYLE: YamlStyle = { indent: 2, indentSeq: true };

// A key with nothing after its colon but perhaps a comment: `nodes:`, `data:`.
// Its children are on the lines below, so their offset is the file's indent.
const OPEN_KEY = /^( *)[^\s#-][^:#]*:\s*(#.*)?$/;
const MAP_KEY = /^( *)[^\s#-][^:#]*:(\s|$)/;
const SEQ_ITEM = /^( *)-(\s|$)/;

/**
 * The indentation `text` was written with, so that writing it back does not
 * re-indent every line. Read from the first child of an open key: a mapping
 * key gives the indent, a sequence item whether lists sit inside their key.
 * `yaml` writes an unindented list two columns left of the indent (column 0
 * at indent 2, column 2 at indent 4), so anything short of the indent reads
 * as unindented. A file with neither, like a new diagram's `nodes: []`, gets
 * the default; so does a `---`, which is not a list item.
 */
export function detectStyle(text: string): YamlStyle {
  let mapOffset: number | null = null;
  let seqOffset: number | null = null;
  let open: number | null = null; // the indent of the open key just above, if any
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (open !== null) {
      const indent = line.length - line.trimStart().length;
      if (seqOffset === null && indent >= open && SEQ_ITEM.test(line)) seqOffset = indent - open;
      else if (mapOffset === null && indent > open && MAP_KEY.test(line)) mapOffset = indent - open;
    }
    if (mapOffset !== null && seqOffset !== null) break;
    const key = OPEN_KEY.exec(line);
    open = key ? key[1].length : null;
  }
  const indent = mapOffset ?? (seqOffset ? seqOffset : DEFAULT_STYLE.indent);
  return { indent, indentSeq: seqOffset === null ? DEFAULT_STYLE.indentSeq : seqOffset >= indent };
}

/**
 * The one file: the structure document, a `---`, and the layout document.
 * A layout document that was read from a file already carries its `---`.
 */
export function joinDocuments(ordoText: string, layoutText: string): string {
  return `${ordoText}${layoutText.startsWith("---") ? "" : "---\n"}${layoutText}`;
}

/**
 * Apply defaults and flatten the skeleton in pre-order (every parent before
 * its children). A shape alias resolves to the registry key it stands for, so
 * `cylinder` and `cyl` are the same value everywhere downstream. A kind's own
 * fields (a tube's taps, a fragment's guards) have no defaults: they are
 * carried exactly as the file has them, present or absent.
 */
export function resolve(file: OrdoFile): ResolvedDiagram {
  const nodeData = file.data?.nodes ?? {};
  const edgeData = file.data?.edges ?? {};
  const nodes: ResolvedNode[] = [];
  const walk = (items: OrdoSkeletonItem[], parent: string | null) => {
    for (const item of items) {
      const [id, kids] = typeof item === "string" ? [item, null] : Object.entries(item)[0];
      const d: OrdoNodeData = Object.hasOwn(nodeData, id) ? nodeData[id] : {};
      const isGroup = kids !== null;
      const kind: OrdoKind = isGroup ? "group" : (d.kind ?? DEFAULTS.kind);
      const label = d.label ?? (LABELLED.has(kind) ? id : undefined);
      const shape = !isGroup && d.shape !== undefined ? (canonicalShape(d.shape) ?? d.shape) : DEFAULTS.shape;
      const fields: Record<string, unknown> = {};
      for (const f of KIND_FIELDS[kind]) if (f !== "kind" && f !== "shape" && d[f] !== undefined) fields[f] = d[f];
      nodes.push({
        id,
        parent,
        isGroup,
        kind,
        ...(label !== undefined ? { label } : {}),
        shape,
        ...(d.type !== undefined ? { type: d.type } : {}),
        ...fields,
      });
      if (kids) walk(kids, id);
    }
  };
  walk(file.nodes, null);
  const edges = (file.edges ?? []).map((e): ResolvedEdge => {
    const d = Object.hasOwn(edgeData, e.id) ? edgeData[e.id] : {};
    const line = d.line ?? DEFAULTS.line;
    return {
      id: e.id,
      from: e.from,
      to: e.to,
      ...(d.label !== undefined ? { label: d.label } : {}),
      line,
      // A width equal to the line's own says nothing the line does not.
      ...(d.width !== undefined && d.width !== lineWidth(line) ? { width: d.width } : {}),
      color: d.color ?? DEFAULTS.color,
      start: d.start ?? DEFAULTS.start,
      end: d.end ?? DEFAULTS.end,
      route: d.route ?? DEFAULTS.route,
      placement: d.placement ?? DEFAULTS.placement,
      hidden: d.hidden ?? false,
    };
  });
  return { nodes, edges };
}
