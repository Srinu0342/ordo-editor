import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { isMap, isScalar, type Document, type LineCounter } from "yaml";
import ordoSchema from "./schema/ordo.schema.json";
import layoutSchema from "./schema/ordo-layout.schema.json";
import {
  KIND_FIELDS,
  type Diagnostic,
  type DiagnosticCode,
  type OrdoFile,
  type OrdoKind,
  type OrdoLayoutFile,
  type OrdoSkeletonItem,
} from "./types.ts";

// Validation, after the YAML has parsed: the JSON Schema first, then the
// integrity rules a schema cannot express. Every diagnostic carries a 1-based
// line and column, so the import dialog (and later the MCP) can point at the
// exact spot.
//
// The shape vocabulary is checked here in code rather than as a schema enum,
// so the schema stays static.

const ajv = new Ajv2020({ allErrors: true, strict: true });
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

function schemaDiagnostics(errors: ErrorObject[], file: FileKind, doc: Document, lc: LineCounter): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const e of errors) {
    if (e.keyword === "oneOf") continue;
    const path = toPath(e.instancePath);
    const key =
      (e.params as { additionalProperty?: string; propertyName?: string }).additionalProperty ??
      (e.params as { propertyName?: string }).propertyName;
    const where = key === undefined ? path : [...path, key];
    const id = where.join("/"); // one message per location: oneOf reports every failed branch
    if (seen.has(id)) continue;
    seen.add(id);
    const pos = locate(doc, lc, path, key);
    const what =
      key !== undefined && e.keyword === "additionalProperties" ? `unknown key "${key}"` : (e.message ?? "invalid");
    out.push({
      severity: "error",
      code: "schema",
      message: `${where.join(".") || "(root)"}: ${what}`,
      file,
      path: where,
      line: pos?.line,
      col: pos?.col,
    });
  }
  return out;
}

function issue(
  code: DiagnosticCode,
  message: string,
  file: FileKind,
  doc: Document,
  lc: LineCounter,
  path: Path,
  key?: string,
  severity: Diagnostic["severity"] = "error",
): Diagnostic {
  const pos = locate(doc, lc, path, key);
  return {
    severity,
    code,
    message,
    file,
    path: key === undefined ? path : [...path, key],
    line: pos?.line,
    col: pos?.col,
  };
}

/** Schema check, then the cross-references JSON Schema cannot express. */
export function validateOrdo(value: unknown, doc: Document, lc: LineCounter, shapes: ReadonlySet<string>): Diagnostic[] {
  if (!checkOrdo(value)) return schemaDiagnostics(checkOrdo.errors ?? [], "ordo", doc, lc);
  const file = value as OrdoFile;
  const out: Diagnostic[] = [];
  const claimed = new Set<string>();
  const nodeIds = new Set<string>();
  const groupIds = new Set<string>();

  const claim = (id: string, path: Path, key?: string) => {
    if (claimed.has(id)) out.push(issue("duplicate-id", `id "${id}" is used more than once`, "ordo", doc, lc, path, key));
    claimed.add(id);
  };
  const walk = (items: OrdoSkeletonItem[], path: Path) =>
    items.forEach((item, i) => {
      if (typeof item === "string") {
        claim(item, [...path, i]);
        nodeIds.add(item);
      } else {
        const [gid, kids] = Object.entries(item)[0];
        claim(gid, [...path, i], gid);
        nodeIds.add(gid);
        groupIds.add(gid);
        walk(kids, [...path, i, gid]);
      }
    });
  walk(file.nodes, ["nodes"]);

  const edgeIds = new Set<string>();
  (file.edges ?? []).forEach((e, i) => {
    claim(e.id, ["edges", i, "id"]);
    edgeIds.add(e.id);
    for (const end of ["from", "to"] as const)
      if (!nodeIds.has(e[end]))
        out.push(
          issue("unknown-endpoint", `edge "${e.id}" ${end} "${e[end]}" is not a node`, "ordo", doc, lc, ["edges", i, end]),
        );
  });

  for (const [id, d] of Object.entries(file.data?.nodes ?? {})) {
    if (!nodeIds.has(id)) {
      out.push(issue("orphan-data", `data for "${id}", which is not in nodes`, "ordo", doc, lc, ["data", "nodes"], id));
      continue;
    }
    if (groupIds.has(id) && d.shape !== undefined) {
      out.push(issue("group-shape", `group "${id}" cannot have a shape`, "ordo", doc, lc, ["data", "nodes", id], "shape"));
      continue;
    }
    // Each kind carries its own fields: a box has a shape, a tube taps, a
    // fragment guards. Anything else on it is a mistake, not a setting.
    const kind: OrdoKind = groupIds.has(id) ? "group" : (d.kind ?? "box");
    const allowed = new Set<string>(["label", "type", ...KIND_FIELDS[kind]]);
    const stray = Object.keys(d).filter((f) => !allowed.has(f));
    for (const f of stray)
      out.push(issue("kind-field", `${kind} "${id}" has no field "${f}"`, "ordo", doc, lc, ["data", "nodes", id], f));
    if (stray.length) continue;
    if (kind === "box" && d.shape !== undefined && !shapes.has(d.shape))
      out.push(issue("unknown-shape", `unknown shape "${d.shape}"`, "ordo", doc, lc, ["data", "nodes", id, "shape"]));
    if (d.attach !== undefined && !edgeIds.has(d.attach))
      out.push(
        issue("unknown-edge", `tube "${id}" rides "${d.attach}", which is not an edge`, "ordo", doc, lc, ["data", "nodes", id, "attach"]),
      );
  }
  for (const id of Object.keys(file.data?.edges ?? {}))
    if (!edgeIds.has(id))
      out.push(issue("orphan-data", `data for "${id}", which is not in edges`, "ordo", doc, lc, ["data", "edges"], id));
  return out;
}

/** Layout is advisory: entries for unknown ids are warnings, dropped on import and on the next export. */
export function validateLayout(value: unknown, doc: Document, lc: LineCounter, ordo: OrdoFile | null): Diagnostic[] {
  if (!checkLayout(value)) return schemaDiagnostics(checkLayout.errors ?? [], "layout", doc, lc);
  if (!ordo) return [];
  const layout = value as OrdoLayoutFile;
  const nodeIds = new Set<string>();
  const walk = (items: OrdoSkeletonItem[]) =>
    items.forEach((item) => {
      if (typeof item === "string") nodeIds.add(item);
      else {
        const [gid, kids] = Object.entries(item)[0];
        nodeIds.add(gid);
        walk(kids);
      }
    });
  walk(ordo.nodes);
  const edgeIds = new Set((ordo.edges ?? []).map((e) => e.id));
  const out: Diagnostic[] = [];
  for (const id of Object.keys(layout.nodes ?? {}))
    if (!nodeIds.has(id))
      out.push(issue("layout-orphan", `layout for unknown node "${id}"`, "layout", doc, lc, ["nodes"], id, "warning"));
  for (const id of Object.keys(layout.edges ?? {}))
    if (!edgeIds.has(id))
      out.push(issue("layout-orphan", `layout for unknown edge "${id}"`, "layout", doc, lc, ["edges"], id, "warning"));
  return out;
}
