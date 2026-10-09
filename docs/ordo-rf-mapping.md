# Ordo ↔ React Flow mapping

A diagram is one file, `<name>.yml`, holding two YAML documents: the
structure and content (`ordo: 1`), then a `---` line, then the layout
(`ordo-layout: 1`). The layout part may be left out; the diagram is then laid
out on import and gains its layout on the next export. Keeping them as two
documents means a drag only changes lines after the `---`, and a rename only
lines before it. The older two-file form (`<name>.layout.yml` beside it)
still imports.

The file is written from the canvas: whatever React Flow nodes and edges are
on it, whether drawn by hand or put there by the Mermaid importer.
Every node type and every field the editor sets has a place in the format, so
any canvas the editor can make exports, imports back unchanged, and exports
again byte-identically. Only `selected`, `dragging`, `resizing` and `measured`
are left out; they describe the session, not the diagram.

The mapping lives in [`src/ordo/rf-mapping.ts`](../src/ordo/rf-mapping.ts). The
vocabularies are enums in [`src/ordo/types.ts`](../src/ordo/types.ts), and the
JSON Schemas in `src/ordo/schema/` are closed, so a misspelt field is an error.

## Nodes

| Ordo `kind` | Canvas `type` | Palette name | Fields in the structure (besides `label`, `type`) |
|---|---|---|---|
| `box` (default) | `box` | the 49 shapes | `shape`: a registry key (`rect`, `cyl`, `diam`…). Mermaid's aliases (`cylinder`, `database`, `diamond`…) are accepted on read. |
| `group` | `container` | Group | `collapsed`, `members`, `mermaid` (the Mermaid type it came from). A group is any one-key map in the skeleton, so it never states its kind. |
| `text` | `label` | Text | — |
| `class` | `compartment` | Class | `sections`: a list of compartments, each a list of rows |
| `tube` | `tube` | Timeline tube | `slots`, `taps`, `variant: track`, `attach` (the edge it rides), `align` |
| `fragment` | `fragment` | Fragment | `operator`, `guards`, `dividers`, `fill` |

A field that does not belong to its node's kind is a `kind-field` error. A
tube's `attach` must name an edge, or it is an `unknown-edge` error.

| Canvas | File |
|---|---|
| `id` | the skeleton id: any non-empty string with no control characters (`n12`, `mermaid-1/A`, `seq:head:App`, `ä`). The writer quotes what YAML would misread. |
| `parentId` | nesting in the skeleton |
| `data.label` | `label`. Defaults to the id for box, group, text and class; a tube or fragment has none unless given one. |
| `data.textSize`, `data.textWeight` | `textSize` (px, 8–72) and `textWeight` (`regular`, `semibold`, `bold`) on a box, group, text or class. Absent means the font its kind (or a box's shape) draws in; the text bar never stores a value equal to that. |
| `data.semanticType` | `type`, e.g. `store/postgres` |
| `position` | layout `x`, `y`, rounded to integers |
| `style.width/height`, or `width/height` after a resize | layout `w`, `h`: always for a group, never for text (a text node is as big as its text, so a `w`, `h` given one is not read), otherwise only when it differs from the size the kind (or a box's shape) is dropped at |
| `zIndex` | layout `z`, when it is not the kind's own (a fragment's is 1) |
| `data.rotation` | layout `rotation` |
| `data.attach` | structure `attach` (which edge) plus layout `t`, `shift`, `angle` (where on it) |
| `style.pointerEvents` on a fragment | not stored: the palette gives every fragment it |
| `data.isDropTarget` | not stored: a drag highlight that only exists while the pointer is held |

## Edges

| Canvas | File (`data.edges.<id>`, default in brackets) |
|---|---|
| `type` | `route`: `step`, `straight`, `orthogonal`, `curved` [`step`] |
| `style.strokeDasharray` | `line`: `solid`, `dotted` (`1 5`), `dashed` (`8 4`), `thick` (solid at width 3) [`solid`] |
| `style.strokeWidth` | `width`, only when it is not the line's own (1.5, or 3 for thick) |
| `style.stroke` | `color` [`#0f172a`] |
| `data.markerStart`, `data.markerEnd` | `start` [`none`], `end` [`arrow`]: `none`, `arrow` (the filled head), `open-arrow`, `circle`, `cross`, `inheritance`, `composition`, `aggregation`, `dependency`, `er-one`, `er-many`, `er-zero-one`, `er-zero-many`, `er-one-many` |
| `data.label` | `label` (`""` means none) |
| `data.labelPlacement` | `placement`: `center`, `above`, `right` [`center`] |
| `data.textSize`, `data.textWeight` | `textSize`, `textWeight`, as on a node [13 px, `regular`] |
| `hidden` | `hidden` [`false`]; Mermaid's `~~~` |
| `source`, `target` | `edges[].from`, `edges[].to` |
| `sourceHandle`, `targetHandle` | layout `edges.<id>.from` / `.to`. The compass anchors `n`, `e`, `s`, `w` are written `top`, `right`, `bottom`, `left`; a tube's taps (`a1`, `b3`) by their own ids |
| `zIndex` | layout `edges.<id>.z` |

An edge with no handles draws each end from the side that faces the other node
(`edges/faces.ts`), the same rule the Mermaid importer uses to pick handles.

## What is still refused

Only things the editor never makes: a node type or edge route it does not
have, a field it never sets (`draggable: false`, React Flow's own
`markerEnd` object, `data.color` on a node), duplicate ids, a parent that is
missing or not a group, or an edge to a missing node. Export names the field
and writes nothing.

## How it is proved

- `src/ordo/__tests__/editor.test.ts`: every palette kind with the edits its component makes, and every route × line × colour × weight and every pair of markers the toolbar offers, round trip.
- `src/mermaid/__tests__/ordo-roundtrip.test.ts`: Mermaid → canvas → Ordo → canvas for every Mermaid input in the repo's tests, flowchart and sequence, plus probes for every importer feature.
- `src/ordo/__tests__/ordo.test.ts`: the spec's GetPut, PutGet, diff-locality table, refusals and validator cases.
