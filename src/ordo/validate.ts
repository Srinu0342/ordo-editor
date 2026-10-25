import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { isMap, isScalar, type Document, type LineCounter } from "yaml";
import ordoSchema from "./schema/ordo.schema.json";
import layoutSchema from "./schema/ordo-layout.schema.json";
import { SHAPE_ALIASES } from "../shapes/aliases.ts";
import { tapCount } from "../nodes/tube.ts";
import { closest } from "./suggest.ts";
import {
  EDGE_FIELD_ORDER,
  ID_PATTERN,
  KIND_FIELDS,
  LEAF_KINDS,
  NODE_FIELD_ORDER,
  type Diagnostic,
  type DiagnosticCode,
  type GuidePage,
  type OrdoKind,
} from "./types.ts";

// Validation, after the YAML has parsed: the JSON Schema and the integrity
// rules a schema cannot express, both every time, so one pass reports every
// error. Every diagnostic carries a 1-based line and column, so the import
// dialog and the MCP can point at the exact spot.
//
// A file that is wrong in one place must not read as wrong in ten. The walk
// over the skeleton and the edges is lenient: what a malformed item most
// likely meant (`- { id: a, label: A }` is node a) still counts as a node, so
// the edges to it are not reported again. The skeleton and the edges list are
// checked here in code rather than by the schema, whose oneOf would report
// each bad item at every level above it; the schema still has the last word
// (see schemaDiagnostics), and covers everything else.
//
// The messages teach, because an agent fixes a file from them: an enum lists
// its values, a misspelling gets the nearest match, a field on the wrong kind
// lists what that kind takes, and a rule the agent guide explains names its
// page (`guide`), which the MCP prints and the editor does not.
//
// The shape vocabulary is checked here in code rather than as a schema enum,
// so the schema stays static.

const ajv = new Ajv2020({ allErrors: true, strict: true, verbose: true });
const checkOrdo: ValidateFunction = ajv.compile(ordoSchema);
const checkLayout: ValidateFunction = ajv.compile(layoutSchema);

type Path = (string | number)[];
type FileKind = "ordo" | "layout";

/** Line/col of the YAML node at `path`; with `key`, of that map key instead of its value. */
export function locate(doc: Document, lc: LineCounter, path: Path, key?: string) {
  if (key !== undefined) {
    const map = doc.getIn(path, true);
    if (isMap(map)) {
      const pair = map.items.find((p) => isScalar(p.key) && String(p.key.value) === key);
      const r = isScalar(pair?.key) ? pair.key.range : undefined;
      if (r) return lc.linePos(r[0]);
    }
  }
  for (let i = path.length; i >= 0; i--) {
    const node = i === 0 ? doc.contents : doc.getIn(path.slice(0, i), true);
    const r = (node as { range?: [number, number, number] } | null)?.range;
    if (r) return lc.linePos(r[0]);
  }
  return undefined;
}

function toPath(instancePath: string): Path {
  return instancePath
    .split("/")
    .slice(1)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

// ---------------------------------------------------------------------------
// Words

const isMapValue = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const dotted = (path: Path) => path.join(".") || "(root)";

/** A value as a message quotes it. */
const show = (v: unknown) => (typeof v === "string" ? `"${v}"` : v === null ? "nothing" : JSON.stringify(v));

/** "a, b or c"; with "and", "a, b and c". */
const either = (words: readonly string[], joiner = "or") =>
  words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} ${joiner} ${words[words.length - 1]}`;

const mean = (word: string | undefined) => (word === undefined ? "" : `; did you mean "${word}"?`);

/** Why a string can't be an id. Only an empty one, or one with a space at an end or a control character, fails ID_PATTERN. */
const badId = (id: string) =>
  `"${id}" is not a usable id: an id can't be empty, start or end with a space, or hold a line break or tab`;

/** What is wrong with a value that should have been text. */
function notText(v: unknown): string {
  if (typeof v === "number" || typeof v === "boolean")
    return `${v} reads as a ${typeof v === "number" ? "number" : "true/false value"}, not text; quote it: "${v}"`;
  if (v === null) return "has no value";
  return Array.isArray(v) ? "must be text, not a list" : "must be text, not a map";
}

// ---------------------------------------------------------------------------
// Vocabulary

const ROOT_KEYS = ["ordo", "nodes", "edges", "data"];
const EDGE_KEYS = ["id", "from", "to"];
const NODE_FIELDS: readonly string[] = NODE_FIELD_ORDER;
const EDGE_FIELDS: readonly string[] = EDGE_FIELD_ORDER;
const LAYOUT_NODE_KEYS = ["x", "y", "w", "h", "z", "rotation", "t", "shift", "angle"];
const LAYOUT_EDGE_KEYS = ["from", "to", "z"];

/** The fields a node of `kind` takes, in the order the writer puts them. */
const fieldsOf = (kind: OrdoKind) =>
  NODE_FIELD_ORDER.filter((f) => f === "label" || f === "type" || (KIND_FIELDS[kind] as readonly string[]).includes(f));

const isLeafKind = (k: unknown): k is Exclude<OrdoKind, "group"> => (LEAF_KINDS as readonly unknown[]).includes(k);

// The guide page that explains a field, for the fields only some diagrams use.
const FIELD_GUIDE: Record<string, GuidePage> = {
  sections: "class",
  slots: "sequence",
  taps: "sequence",
  variant: "sequence",
  attach: "sequence",
  align: "sequence",
  operator: "sequence",
  guards: "sequence",
  dividers: "sequence",
  fill: "sequence",
};
const KIND_GUIDE: Partial<Record<OrdoKind, GuidePage>> = { class: "class", tube: "sequence", fragment: "sequence" };

// What other tools call a value Ordo spells another way: React Flow's routes
// and markers, CSS's weights, a few shapes by their everyday names. Offered
// only when the value it stands for is one the field takes.
const SYNONYMS: Record<string, string> = {
  smoothstep: "step",
  bezier: "curved",
  spline: "curved",
  arrowclosed: "arrow",
  triangle: "arrow",
  "arrow-open": "open-arrow",
  normal: "regular",
  "400": "regular",
  "600": "semibold",
  "700": "bold",
  box: "rect",
  square: "rect",
  oval: "circle",
  ellipse: "circle",
  actor: "person",
  user: "person",
  server: "rect",
  queue: "h-cyl", // what the sequence importer draws a Mermaid queue as
};

/** The value among `allowed` that `given` most likely meant. */
function suggest(given: unknown, allowed: readonly string[]): string | undefined {
  if (typeof given !== "string" && typeof given !== "number") return undefined;
  const word = String(given);
  const synonym = Object.hasOwn(SYNONYMS, word.toLowerCase()) ? SYNONYMS[word.toLowerCase()] : undefined;
  if (synonym !== undefined && allowed.includes(synonym)) return synonym;
  return closest(word, allowed);
}

/** The shape `name` most likely meant, as its registry key: `cylnder` → `cylinder` → `cyl`. */
function suggestShape(name: string, shapes: ReadonlySet<string>): string | undefined {
  const near = suggest(name, [...shapes]);
  if (near === undefined) return undefined;
  const key = Object.hasOwn(SHAPE_ALIASES, near) ? SHAPE_ALIASES[near] : near;
  return shapes.has(key) ? key : near;
}

// ---------------------------------------------------------------------------
// Findings

/** A problem before it has a position. */
type Finding = {
  code: DiagnosticCode;
  message: string;
  path: Path;
  key?: string; // the map key the problem is about: its position is the key's, not the value's
  severity?: Diagnostic["severity"];
  guide?: GuidePage;
  first?: { path: Path; key?: string }; // a duplicate's first sighting, named in the message by its line
};

type Report = (f: Finding) => void;

function diagnostic(f: Finding, file: FileKind, doc: Document, lc: LineCounter): Diagnostic {
  const pos = locate(doc, lc, f.path, f.key);
  const first = f.first && locate(doc, lc, f.first.path, f.first.key);
  return {
    severity: f.severity ?? "error",
    code: f.code,
    message: first ? `${f.message} (first on line ${first.line})` : f.message,
    file,
    path: f.key === undefined ? f.path : [...f.path, f.key],
    line: pos?.line,
    col: pos?.col,
    ...(f.guide ? { guide: f.guide } : {}),
  };
}

/** Top to bottom; a diagnostic with no position last. Stable, so ties keep the order they were found in. */
const rank = (n: number | undefined) => n ?? Number.MAX_SAFE_INTEGER;
const byPosition = (a: Diagnostic, b: Diagnostic) => rank(a.line) - rank(b.line) || rank(a.col) - rank(b.col);

// ---------------------------------------------------------------------------
// The skeleton and the edges

/** Whether a node is a group, or null when its skeleton item is malformed and that can't be told. */
type NodeFact = { group: boolean | null };

type Survey = {
  nodes: Map<string, NodeFact>;
  edges: Set<string>;
  ends: Map<string, { from?: string; to?: string }>; // each edge's ends, where they are text
};

/**
 * Every node and edge id the structure names, read leniently, with what is
 * wrong with the skeleton and the edges list reported as it goes: the shape of
 * each item, duplicate ids, and edges whose ends are not nodes.
 */
function survey(value: unknown, report: Report = () => {}): Survey {
  const nodes = new Map<string, NodeFact>();
  const edges = new Set<string>();
  const endsOf = new Map<string, { from?: string; to?: string }>();
  const root = isMapValue(value) ? value : {};
  const schema = (message: string, path: Path, key?: string) => report({ code: "schema", message, path, key });

  // Nodes and edges share one set of ids.
  const claimed = new Map<string, { path: Path; key?: string; edge: boolean }>();
  const claim = (id: string, path: Path, key: string | undefined, edge: boolean) => {
    const first = claimed.get(id);
    if (!first) {
      claimed.set(id, { path, key, edge });
      return;
    }
    const message =
      first.edge === edge
        ? `id "${id}" is used more than once`
        : `id "${id}" names both a node and an edge; nodes and edges share one set of ids`;
    report({ code: "duplicate-id", message, path, key, first: { path: first.path, key: first.key } });
  };
  const node = (id: string, path: Path, key: string | undefined, group: boolean | null) => {
    claim(id, path, key, false);
    if (!nodes.has(id)) nodes.set(id, { group });
  };

  const walk = (items: unknown[], path: Path) => items.forEach((item, i) => skeletonItem(item, [...path, i]));

  const skeletonItem = (item: unknown, path: Path) => {
    if (typeof item === "string") {
      if (!ID_PATTERN.test(item)) schema(`${dotted(path)}: ${badId(item)}`, path);
      node(item, path, undefined, false);
    } else if (typeof item === "number" || typeof item === "boolean") {
      schema(`${dotted(path)}: ${notText(item)}`, path);
      node(String(item), path, undefined, false);
    } else if (Array.isArray(item)) {
      schema(`${dotted(path)}: a list inside the list; nest nodes in a group instead: - group-id: [a, b]`, path);
      walk(item, path);
    } else if (isMapValue(item)) {
      mapItem(item, path);
    } else {
      schema(`${dotted(path)}: an empty item; give a node id or remove the -`, path);
    }
  };

  const mapItem = (item: Record<string, unknown>, path: Path) => {
    const keys = Object.keys(item);
    if (keys.length === 0) {
      schema(`${dotted(path)}: an empty map; a group is - group-id: [children]`, path);
      return;
    }

    // `- { id: a, label: A }`: a node written with its fields, as other formats do.
    if (typeof item.id === "string") {
      const id = item.id;
      const kids = keys.find((k) => k !== "id" && Array.isArray(item[k]));
      const rest = keys.filter((k) => k !== "id" && k !== kids);
      const fields = rest.length ? `, and put ${either(rest, "and")} under data.nodes.${id}` : "";
      const nest = kids ? `; to make it a group, write - ${id}: [its children]` : "";
      schema(`${dotted(path)}: nodes lists ids, not fields: write - ${id} here${fields}${nest}`, path);
      node(id, path, undefined, kids ? true : false);
      if (kids) walk(item[kids] as unknown[], [...path, kids]);
      return;
    }

    if (keys.length > 1) {
      const lists = keys.filter((k) => Array.isArray(item[k]));
      if (lists.length > 1) schema(`${dotted(path)}: ${either(lists, "and")} share one item; give each group its own -`, path);
      else {
        const id = lists[0] ?? keys[0];
        const rest = keys.filter((k) => k !== id);
        schema(
          `${dotted(path)}: a group is a map with one key, its id (- ${id}: [children]); put ${either(rest, "and")} under data.nodes.${id}`,
          path,
        );
      }
      for (const k of keys) if (Array.isArray(item[k])) node(k, path, k, true);
      for (const k of keys) if (Array.isArray(item[k])) walk(item[k] as unknown[], [...path, k]);
      if (!lists.length) node(keys[0], path, keys[0], null);
      return;
    }

    const [id] = keys;
    const kids = item[id];
    if (!ID_PATTERN.test(id)) schema(`${dotted(path)}: ${badId(id)}`, path, id);
    if (Array.isArray(kids)) {
      node(id, path, id, true);
      walk(kids, [...path, id]);
      return;
    }
    if (isMapValue(kids)) {
      // `- a: { label: A }`: a leaf, with its fields where its children would go.
      schema(`${dotted(path)}: nodes lists ids, not fields: write - ${id}, and put its fields under data.nodes.${id}`, path, id);
      node(id, path, id, false);
      return;
    }
    const why =
      kids === null
        ? `group "${id}" has no children: indent them under it, write - ${id}: [] for an empty group, or - ${id} for a plain node`
        : `group "${id}" must list its children: - ${id}: [a, b]`;
    schema(`${dotted(path)}: ${why}`, path, id);
    node(id, path, id, null);
  };

  const items = root.nodes;
  if (Array.isArray(items)) walk(items, ["nodes"]);
  else if (isMapValue(items)) {
    schema("nodes: must be a list of ids (- api), not a map; put each node's fields under data.nodes", ["nodes"]);
    for (const [k, v] of Object.entries(items)) {
      node(k, ["nodes"], k, Array.isArray(v));
      if (Array.isArray(v)) walk(v, ["nodes", k]);
    }
  } else if (items !== undefined) schema("nodes: must be a list of node ids ([] for none)", ["nodes"]);

  // An edge's own ends: its id claimed, and each end that is text checked against the nodes.
  const ends = (id: unknown, body: Record<string, unknown>, path: Path, idAt: { path: Path; key?: string }) => {
    if (typeof id === "string") {
      claim(id, idAt.path, idAt.key, true);
      edges.add(id);
      const text = (v: unknown) => (typeof v === "string" ? v : undefined);
      if (!endsOf.has(id)) endsOf.set(id, { from: text(body.from), to: text(body.to) });
    }
    const name = typeof id === "string" ? `"${id}"` : `at ${dotted(path)}`;
    for (const end of ["from", "to"] as const) {
      const v = body[end];
      if (typeof v === "string" && !nodes.has(v))
        report({
          code: "unknown-endpoint",
          message: `edge ${name} ${end} "${v}" is not a node${mean(closest(v, nodes.keys()))}`,
          path: [...path, end],
        });
    }
  };

  const edge = (e: unknown, path: Path) => {
    if (!isMapValue(e)) {
      schema(`${dotted(path)}: an edge is a map: - { id: e1, from: a, to: b }`, path);
      return;
    }
    const keys = Object.keys(e);
    // `- e1: { from: a, to: b }`: the edge keyed by its id.
    if (e.id === undefined && keys.length === 1 && isMapValue(e[keys[0]])) {
      const id = keys[0];
      schema(`${dotted(path)}: write an edge as - { id: ${id}, from: …, to: … }, its id inside the braces`, path, id);
      ends(id, e[id] as Record<string, unknown>, [...path, id], { path, key: id });
      return;
    }
    const id = typeof e.id === "string" ? e.id : "<id>";
    for (const k of keys) {
      if (EDGE_KEYS.includes(k)) continue;
      const why = EDGE_FIELDS.includes(k)
        ? `${k} goes under data.edges.${id}; an edge in this list has only id, from and to`
        : `unknown key "${k}"${mean(closest(k, EDGE_KEYS))}; an edge in this list has only id, from and to`;
      schema(`${dotted(path)}: ${why}`, path, k);
    }
    for (const f of EDGE_KEYS) {
      const v = e[f];
      if (v === undefined) schema(`${dotted(path)}: the edge has no ${f}`, path);
      else if (typeof v !== "string") schema(`${dotted([...path, f])}: ${notText(v)}`, [...path, f]);
      else if (!ID_PATTERN.test(v)) schema(`${dotted([...path, f])}: ${badId(v)}`, [...path, f]);
    }
    ends(e.id, e, path, { path: [...path, "id"] });
  };

  const list = root.edges;
  if (Array.isArray(list)) list.forEach((e, i) => edge(e, ["edges", i]));
  else if (isMapValue(list)) {
    schema("edges: must be a list: - { id: e1, from: a, to: b }", ["edges"]);
    for (const [k, v] of Object.entries(list)) if (isMapValue(v)) ends(k, v, ["edges", k], { path: ["edges"], key: k });
  } else if (list === null) schema("edges: has no value; write edges: [] or leave it out", ["edges"]);
  else if (list !== undefined) schema("edges: must be a list of - { id, from, to }", ["edges"]);

  return { nodes, edges, ends: endsOf };
}

// ---------------------------------------------------------------------------
// data

function checkData(root: Record<string, unknown>, facts: Survey, shapes: ReadonlySet<string>, report: Report) {
  const data = isMapValue(root.data) ? root.data : {};
  const nodeData = isMapValue(data.nodes) ? data.nodes : {};
  const edgeData = isMapValue(data.edges) ? data.edges : {};

  for (const [id, d] of Object.entries(nodeData)) {
    const fact = facts.nodes.get(id);
    if (!fact) {
      if (!ID_PATTERN.test(id)) continue; // the schema reports the key
      const message = facts.edges.has(id)
        ? `"${id}" is an edge, so its data goes under data.edges`
        : `data for "${id}", which is not in nodes${mean(closest(id, facts.nodes.keys()))}`;
      report({ code: "orphan-data", message, path: ["data", "nodes"], key: id });
      continue;
    }
    // Not a map: the schema says so. A malformed skeleton item: which fields it may have can't be told.
    if (!isMapValue(d) || fact.group === null) continue;
    const at = ["data", "nodes", id];

    if (fact.group) {
      if (d.shape !== undefined)
        report({
          code: "group-shape",
          message: `group "${id}" cannot have a shape: it is drawn as a frame round its children. For a shape, list "${id}" in nodes as a plain id`,
          path: at,
          key: "shape",
        });
      if (d.kind !== undefined)
        report({
          code: "kind-field",
          message: `group "${id}" has no field "kind": it is a group because it has children in nodes`,
          path: at,
          key: "kind",
        });
    }

    const kind: OrdoKind | null = fact.group ? "group" : d.kind === undefined ? "box" : isLeafKind(d.kind) ? d.kind : null;
    if (kind === null) continue; // a kind Ordo doesn't have: the schema lists the kinds

    // Each kind carries its own fields: a box has a shape, a tube taps, a
    // fragment guards. Anything else on it is a mistake, not a setting. A key
    // no node has at all is the schema's to report.
    const allowed = fieldsOf(kind);
    for (const f of Object.keys(d)) {
      if (!NODE_FIELDS.includes(f) || (allowed as readonly string[]).includes(f)) continue;
      if (kind === "group" && (f === "shape" || f === "kind")) continue; // said above
      report({
        code: "kind-field",
        message: `${kind} "${id}" has no field "${f}"; a ${kind} takes ${either(allowed, "and")}`,
        path: at,
        key: f,
        guide: FIELD_GUIDE[f] ?? KIND_GUIDE[kind],
      });
    }

    if (kind === "box" && typeof d.shape === "string" && !shapes.has(d.shape))
      report({
        code: "unknown-shape",
        message: `unknown shape "${d.shape}"${mean(suggestShape(d.shape, shapes))}`,
        path: [...at, "shape"],
        guide: "core",
      });
    if (kind === "tube" && typeof d.attach === "string" && !facts.edges.has(d.attach))
      report({
        code: "unknown-edge",
        message: `tube "${id}" rides "${d.attach}", which is not an edge${mean(closest(d.attach, facts.edges))}`,
        path: [...at, "attach"],
        guide: "sequence",
      });

    // Both draw, so they are warnings; but a frame or a tube drawn this way is
    // not the one meant. Ordo itself never writes either.
    const taps = d.taps;
    if (kind === "tube" && Array.isArray(taps) && taps.some((tap, i) => i > 0 && !(Number(tap) >= Number(taps[i - 1]))))
      report({
        code: "tap-order",
        message: `tube "${id}" lists its taps out of order; list them smallest first, since a message names a tap by its place in the list`,
        path: [...at, "taps"],
        severity: "warning",
        guide: "sequence",
      });
    const guards = Array.isArray(d.guards) ? d.guards.length : 0;
    const dividers = Array.isArray(d.dividers) ? d.dividers.length : 0;
    if (kind === "fragment" && d.operator !== "rect" && (guards || dividers) && guards !== dividers + 1)
      report({
        code: "guard-count",
        message: `fragment "${id}" has ${guards} guard${guards === 1 ? "" : "s"} and ${dividers} divider${dividers === 1 ? "" : "s"}; it needs a guard for each section, and a divider before each section after the first`,
        path: at,
        key: Array.isArray(d.guards) ? "guards" : "dividers",
        severity: "warning",
        guide: "sequence",
      });
  }

  for (const id of Object.keys(edgeData)) {
    if (facts.edges.has(id) || !ID_PATTERN.test(id)) continue;
    const message = facts.nodes.has(id)
      ? `"${id}" is a node, so its data goes under data.nodes`
      : `data for "${id}", which is not in edges${mean(closest(id, facts.edges))}`;
    report({ code: "orphan-data", message, path: ["data", "edges"], key: id });
  }
}

// ---------------------------------------------------------------------------
// The schema's errors, in words

// Keys other tools use, and where Ordo says the same thing, by the map they turn up in.
const LAYOUT_ONLY = "positions and sizes are the layout's, which Ordo writes; leave them out";
const ROOT_HINTS: Record<string, string> = {
  title: "a diagram is named by its folder, .ordo/<name>/; for a title on the canvas, add a text node",
  name: "a diagram is named by its folder, .ordo/<name>/; for a title on the canvas, add a text node",
  direction: "Ordo lays a file with no layout out top to bottom; the user arranges it from there",
};
const NODE_HINTS: Record<string, string> = {
  name: "the text a node shows is its label",
  text: "the text a node shows is its label",
  parent: "nesting comes from nodes: list the node under its group there",
  children: "nesting comes from nodes: list the children under their group there",
  x: LAYOUT_ONLY,
  y: LAYOUT_ONLY,
  width: LAYOUT_ONLY,
  height: LAYOUT_ONLY,
  position: LAYOUT_ONLY,
};
const EDGE_HINTS: Record<string, string> = {
  source: "an edge's ends are its from and to, in the edges list",
  target: "an edge's ends are its from and to, in the edges list",
  type: "the way an edge runs is its route",
  arrow: "the markers at the ends are start and end",
  arrowhead: "the markers at the ends are start and end",
  markerEnd: "the markers at the ends are start and end",
  markerStart: "the markers at the ends are start and end",
  style: "an edge's look is line, width and color",
  stroke: "an edge's look is line, width and color",
};

type KeyContext = { allowed: readonly string[]; what: string; hints?: Record<string, string>; guide?: GuidePage };

/** Which map an unknown key was found in, and what that map takes. */
function keyContext(path: Path, file: FileKind, facts: Survey | null, root: Record<string, unknown>): KeyContext | null {
  if (file === "layout") {
    if (path.length === 0) return { allowed: ["ordo-layout", "nodes", "edges"], what: "the layout has", guide: "editing" };
    if (path.length === 2 && path[0] === "nodes") return { allowed: LAYOUT_NODE_KEYS, what: "a node's layout has", guide: "editing" };
    if (path.length === 2 && path[0] === "edges") return { allowed: LAYOUT_EDGE_KEYS, what: "an edge's layout has", guide: "editing" };
    return null;
  }
  if (path.length === 0) return { allowed: ROOT_KEYS, what: "the structure has", hints: ROOT_HINTS };
  if (path.length === 1 && path[0] === "data") return { allowed: ["nodes", "edges"], what: "data has" };
  if (path.length === 3 && path[0] === "data" && path[1] === "edges")
    return { allowed: EDGE_FIELDS, what: "an edge takes", hints: EDGE_HINTS };
  if (path.length === 3 && path[0] === "data" && path[1] === "nodes") {
    const id = String(path[2]);
    const fact = facts?.nodes.get(id);
    const nodeData = isMapValue(root.data) && isMapValue(root.data.nodes) ? root.data.nodes : {};
    const d = Object.hasOwn(nodeData, id) && isMapValue(nodeData[id]) ? nodeData[id] : {};
    const kind: OrdoKind | null =
      fact?.group === true ? "group" : fact?.group === false ? (d.kind === undefined ? "box" : isLeafKind(d.kind) ? d.kind : null) : null;
    return kind
      ? { allowed: fieldsOf(kind), what: `a ${kind} takes`, hints: NODE_HINTS, guide: KIND_GUIDE[kind] }
      : { allowed: NODE_FIELDS, what: "a node takes", hints: NODE_HINTS };
  }
  return null;
}

/** The last segment of a path that is a key, for messages about a field. */
const fieldOf = (path: Path) => {
  const last = path[path.length - 1];
  return typeof last === "string" ? last : undefined;
};

function explain(e: ErrorObject, path: Path, file: FileKind, facts: Survey | null, root: Record<string, unknown>): Omit<Finding, "code" | "path"> {
  const at = dotted(path);
  const field = fieldOf(path);
  const params = e.params as Record<string, unknown>;
  const fieldGuide = file === "layout" ? "editing" : field !== undefined ? FIELD_GUIDE[field] : undefined;

  switch (e.keyword) {
    case "additionalProperties": {
      const key = String(params.additionalProperty);
      const where = keyContext(path, file, facts, root);
      const near = where ? closest(key, where.allowed) : undefined;
      const hint = where?.hints && Object.hasOwn(where.hints, key) ? `; ${where.hints[key]}` : "";
      const takes = where ? `; ${where.what} ${either(where.allowed, "and")}` : "";
      const fix = near !== undefined ? mean(near) : hint || takes;
      return { key, message: `${dotted([...path, key])}: unknown key "${key}"${fix}`, guide: where?.guide };
    }
    case "enum": {
      const allowed = ((params.allowedValues ?? e.schema ?? []) as unknown[]).map(String);
      const group = field === "kind" && e.data === "group" ? "; a node is a group because it has children in nodes" : "";
      return {
        message: `${at}: must be one of ${allowed.join(", ")}, not ${show(e.data)}${group || mean(suggest(e.data, allowed))}`,
        guide: fieldGuide,
      };
    }
    case "const":
      return { message: `${at}: must be ${show(params.allowedValue)}, the format's version, not ${show(e.data)}` };
    case "required": {
      const missing = String(params.missingProperty);
      const why =
        file === "ordo" && path.length === 0 && missing === "nodes"
          ? "the file has no nodes; list the node ids under nodes ([] for none)"
          : file === "layout" && (missing === "x" || missing === "y")
            ? `missing ${missing}: a node's layout needs both x and y`
            : `missing ${missing}`;
      return { message: `${at}: ${why}`, guide: fieldGuide };
    }
    case "type": {
      const want = String(params.type);
      let why: string;
      if (want === "string") {
        why = notText(e.data);
        if (e.data === null && (field === "color" || field === "fill"))
          why += '; quote a colour, like "#16a34a": an unquoted # starts a YAML comment';
      } else if (e.data === null) why = "has no value";
      else if (want === "array") why = field === "sections" ? "must be a list of compartments, each a list of rows: [[a, b], [c()]]" : "must be a list";
      else if (want === "object") why = "must be a map";
      else if (want === "integer") why = `must be a whole number, not ${show(e.data)}`;
      else if (want === "number") why = `must be a number, not ${show(e.data)}`;
      else if (want === "boolean") why = `must be true or false, not ${show(e.data)}`;
      else why = e.message ?? "invalid";
      return { message: `${at}: ${why}`, guide: fieldGuide };
    }
    case "pattern":
      if (e.schemaPath.includes("/id/")) {
        // Under propertyNames, Ajv names the key on the error itself.
        const key = e.propertyName ?? (params.propertyName === undefined ? undefined : String(params.propertyName));
        return { key, message: `${dotted(key === undefined ? path : [...path, key])}: ${badId(String(key ?? e.data))}` };
      }
      return {
        message: `${at}: ${show(e.data)} is not a type; a type is lower-case words joined by / and -, like store/postgres`,
      };
    case "propertyNames": {
      const key = String(params.propertyName);
      return { key, message: `${dotted([...path, key])}: ${badId(key)}` };
    }
    case "minimum":
    case "maximum": {
      const s = (e.parentSchema ?? {}) as { minimum?: number; maximum?: number; type?: string };
      const whole = s.type === "integer" ? "a whole number" : "a number";
      const range =
        s.minimum !== undefined && s.maximum !== undefined
          ? `must be ${whole} from ${s.minimum} to ${s.maximum}`
          : s.minimum !== undefined
            ? `must be at least ${s.minimum}`
            : `must be at most ${s.maximum}`;
      return { message: `${at}: ${range}, not ${show(e.data)}`, guide: fieldGuide };
    }
    case "exclusiveMinimum":
      return { message: `${at}: must be more than ${params.limit}, not ${show(e.data)}` };
    case "minProperties":
      return { message: `${at}: is empty; give it what it needs or remove it`, guide: fieldGuide };
    default:
      return { message: `${at}: ${e.message ?? "invalid"}`, guide: fieldGuide };
  }
}

/**
 * The schema's errors as findings, one per location. `own` names the parts
 * the survey checks in code (the skeleton and the edges list): the schema's
 * errors there are dropped as long as the survey found something wrong there
 * too, so the file is never let through on a rule the survey missed.
 */
function schemaFindings(
  errors: ErrorObject[],
  file: FileKind,
  facts: Survey | null,
  root: unknown,
  own: { nodes: boolean; edges: boolean } = { nodes: false, edges: false },
): Finding[] {
  const value = isMapValue(root) ? root : {};
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const e of errors) {
    if (e.keyword === "oneOf") continue;
    const path = toPath(e.instancePath);
    if (file === "ordo" && (path[0] === "nodes" || path[0] === "edges") && own[path[0]]) continue;
    const f = explain(e, path, file, facts, value);
    // One message per location: a key's own problems are its, and a missing
    // property is one message per property.
    const where = f.key === undefined ? path : [...path, f.key];
    const id = `${where.join("/")}|${e.keyword === "required" ? String((e.params as { missingProperty?: string }).missingProperty) : ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ code: "schema", path, ...f });
  }
  return out;
}

// ---------------------------------------------------------------------------

/** The schema, the skeleton and edges, and the cross-references JSON Schema cannot express; all of them, every time. */
export function validateOrdo(value: unknown, doc: Document, lc: LineCounter, shapes: ReadonlySet<string>): Diagnostic[] {
  const findings: Finding[] = [];
  const facts = survey(value, (f) => findings.push(f));
  const root = isMapValue(value) ? value : {};
  checkData(root, facts, shapes, (f) => findings.push(f));
  if (!checkOrdo(value)) {
    const own = { nodes: false, edges: false };
    for (const f of findings) if (f.code === "schema" && (f.path[0] === "nodes" || f.path[0] === "edges")) own[f.path[0]] = true;
    findings.push(...schemaFindings(checkOrdo.errors ?? [], "ordo", facts, value, own));
  }
  return findings.map((f) => diagnostic(f, "ordo", doc, lc)).sort(byPosition);
}

// The anchors an edge can end on, by kind: the four sides of a box, group,
// text or class (a file names them top, right, bottom and left; the canvas's
// n, e, s and w read too); a tube's taps, a<i> on its left and b<i> on its
// right, and its head and tail; and nothing on a fragment.
const SIDES = ["top", "right", "bottom", "left"];

function anchorsOf(id: string, facts: Survey, root: Record<string, unknown>): { kind: OrdoKind; names: string[]; taps: number } | null {
  const fact = facts.nodes.get(id);
  if (!fact || fact.group === null) return null;
  const nodeData = isMapValue(root.data) && isMapValue(root.data.nodes) ? root.data.nodes : {};
  const d = Object.hasOwn(nodeData, id) && isMapValue(nodeData[id]) ? nodeData[id] : {};
  const kind: OrdoKind | null = fact.group ? "group" : d.kind === undefined ? "box" : isLeafKind(d.kind) ? d.kind : null;
  if (kind === null) return null;
  if (kind === "fragment") return { kind, names: [], taps: 0 };
  if (kind !== "tube") return { kind, names: [...SIDES, "n", "e", "s", "w"], taps: 0 };
  const taps = tapCount(d);
  const each = Array.from({ length: taps }, (_, i) => i);
  return { kind, names: ["head", "tail", ...each.map((i) => `a${i}`), ...each.map((i) => `b${i}`)], taps };
}

/** Why an edge's end can't be drawn on the anchor its layout names. */
function handleMessage(edge: string, side: "from" | "to", name: string, node: string, anchors: { kind: OrdoKind; taps: number }): string {
  const at = `edge "${edge}" ${side === "from" ? "leaves from" : "arrives at"} "${name}"`;
  if (anchors.kind === "fragment") return `${at}, but fragment "${node}" has no anchors, so the edge isn't drawn`;
  if (anchors.kind === "tube") {
    const last = anchors.taps - 1;
    const has = anchors.taps === 0 ? "no taps" : last === 0 ? "taps a0 and b0" : `taps a0–a${last} and b0–b${last}`;
    return `${at}, but tube "${node}" has ${has}, so the edge isn't drawn`;
  }
  const near = closest(name, SIDES);
  return `${at}, which ${anchors.kind} "${node}" doesn't have, so the edge isn't drawn${near ? mean(near) : `; its anchors are ${either(SIDES, "and")}`}`;
}

/**
 * Layout is advisory: entries for ids the structure doesn't have are warnings,
 * dropped on import and on the next export, and so is an edge whose layout
 * names an anchor its node doesn't have, which React Flow then doesn't draw.
 * `structure` is the structure document's value, read even when it has
 * errors, so a layout is checked against the ids it names.
 */
export function validateLayout(value: unknown, doc: Document, lc: LineCounter, structure: unknown): Diagnostic[] {
  const findings: Finding[] = [];
  const facts = structure === null || structure === undefined ? null : survey(structure);
  if (!checkLayout(value)) findings.push(...schemaFindings(checkLayout.errors ?? [], "layout", facts, value));
  if (facts) {
    const layout = isMapValue(value) ? value : {};
    const orphans = (part: "nodes" | "edges", known: { has(id: string): boolean }, what: string) => {
      const entries = isMapValue(layout[part]) ? layout[part] : {};
      for (const id of Object.keys(entries))
        if (!known.has(id))
          findings.push({
            code: "layout-orphan",
            message: `layout for unknown ${what} "${id}"`,
            path: [part],
            key: id,
            severity: "warning",
            guide: "editing",
          });
    };
    orphans("nodes", facts.nodes, "node");
    orphans("edges", facts.edges, "edge");

    const root = isMapValue(structure) ? structure : {};
    const handles = isMapValue(layout.edges) ? layout.edges : {};
    for (const [id, h] of Object.entries(handles)) {
      const ends = facts.ends.get(id);
      if (!ends || !isMapValue(h)) continue;
      for (const side of ["from", "to"] as const) {
        const name = h[side];
        const node = ends[side];
        if (typeof name !== "string" || node === undefined) continue;
        const anchors = anchorsOf(node, facts, root);
        if (!anchors || anchors.names.includes(name)) continue;
        findings.push({
          code: "unknown-handle",
          message: handleMessage(id, side, name, node, anchors),
          path: ["edges", id, side],
          severity: "warning",
          guide: anchors.kind === "tube" ? "sequence" : "editing",
        });
      }
    }
  }
  return findings.map((f) => diagnostic(f, "layout", doc, lc)).sort(byPosition);
}
