---
generated_by: claude
human_requestor: Subhadip
date: 2026-09-16
review_status: unreviewed
reviewed_by:
---

# Ordo — Four Workstreams

## How to read this

Four workstreams, written so that WS3 and WS4 can start immediately and WS1
and WS2 can stay in research while they do. Each workstream has a goal, a
scope boundary, a work breakdown, an explicit "done" definition, and the
questions it is expected to *answer for other workstreams* rather than
resolve alone. ⟦REVIEW⟧

The coupling is real and worth stating once rather than arguing repeatedly:
WS1 (format) and WS2 (engine) are one design problem viewed from two sides,
and WS3 and WS4 both produce evidence that constrains them. Starting at 3
and 4 is coherent on exactly that reading — they are not deferred work, they
are the empirical input that makes the format decisions decidable instead of
speculative. This document is written to make that payload explicit: every
WS3 and WS4 section ends with what it hands back. ⟦REVIEW⟧

---

## Workstream 3 — Node and edge library

### Goal

A catalogue of node and edge components, each expressible in two rendering
contexts (headless SVG, React Flow canvas) from one definition, with a
documented extension path for third parties. ⟦REVIEW⟧

### The organising cut

Structural variants are node *types*. Shape variants are *theme properties*.
A UML class node has compartments, internal layout, and a field list — it is
a type. A stadium is a rectangle whose corner radius equals half its height —
it is a rectangle with a theme value. Mermaid's expanded flowchart shape set
is the stress test for this: the library introduced roughly thirty additional
shapes in the v11.3 line, addressed through an `A@{ shape: rect }` form, and
a catalogue that treats each as a distinct component would be thirty
components that must all change whenever the draw signature moves
⟦REVIEW src: mermaid.js.org/syntax/flowchart, "Expanded Node Shapes in
Mermaid Flowcharts (v11.3.0+)"⟧. Under the cut proposed here, nearly all of
them import as one type carrying a shape property. ⟦REVIEW⟧

### Scope for the first pass

Four components, chosen to cover the four structural behaviours rather than
to look impressive: ⟦REVIEW⟧

1. **Box** — single label, parameterised outline. Absorbs rect, rounded,
   stadium, circle, diamond, hexagon, cylinder, parallelogram, trapezoid and
   the rest of the shape zoo as property values.
2. **Compartment node** — stacked sections with independent content (UML
   class, ER entity). Exercises internal layout and variable intrinsic height.
3. **Container** — holds child nodes, has its own frame and title band (group,
   subgraph, C4 boundary, UML package). Exercises the containment tree.
4. **Label** — text with no frame. Exercises the degenerate case where there
   is no box to anchor edges to. ⟦REVIEW⟧

Three edge components: straight/polyline, orthogonal, curved. Arrowheads,
dash patterns, thickness and end-decorations are edge *theme* properties, not
separate edge types, by the same cut. ⟦REVIEW⟧

### The `drawNode` contract

Each component exports a pure function returning a flat op-list — rects,
paths, text runs, each with geometry and a theme token reference rather than
a literal colour. No SVG strings, no React elements. The headless renderer
walks the op-list to SVG text; the React Flow custom node walks the same
op-list to JSX elements, then wraps it in interaction chrome (handles,
resizer overlay, selection ring) that never appears in the op-list. ⟦REVIEW⟧

The op-list is the seam that keeps React out of the headless dependency tree
and avoids `dangerouslySetInnerHTML` on the canvas side. Get its shape wrong
and every component needs rewriting, which is the argument for four
components rather than thirty at this stage. ⟦REVIEW⟧

### Work breakdown

- Define the op type union. Start minimal: `rect`, `path`, `text`, `group`.
  Resist adding ops until a component demands one.
- Define the theme token vocabulary the ops reference. Tokens, not values —
  resolution against `ordo.theme` happens in the renderer.
- Write `drawNode` for Box, with shape as a parameter. Prove the shape zoo
  claim by implementing eight Mermaid shapes as parameter values only.
- Write the SVG walker in plain Node. No DOM, no jsdom.
- Write the React walker. Confirm the same op-list produces visually matching
  output in both.
- Add Compartment, Container, Label.
- Write the three edge components against the same op-list type.
- Document the extension contract: what a third-party node package must
  export, how it declares its theme tokens, how it is registered. ⟦REVIEW⟧

### Done when

An op-list produced from a hand-written fixture renders identically through
both walkers, and a node component written *outside* the repo can be
registered and rendered without modifying core. ⟦REVIEW⟧

### What this hands back

- Whether node size is authored or intrinsic. Compartment nodes want to size
  from content; boxes do not care. Whichever way this lands, it is the single
  most consequential input to the write-back layer in WS2.
- The theme token vocabulary, which becomes `ordo.theme`'s schema in WS1.
- Whether containers need their children in parent-relative or absolute
  coordinates — a WS1 open question that the Container component will answer
  by being awkward one way and natural the other. ⟦REVIEW⟧

---

## Workstream 4 — Mermaid conversion

### Goal

A converter that takes Mermaid source and produces an Ordo document set. Not
a renderer of Mermaid, and not a fork of Mermaid.

### Why this is a legitimate early start

It produces visible output from real inputs before any Ordo file has been
written by hand, and it forces the type vocabulary to confront a real corpus
rather than an imagined one. It also produces the corpus that WS1 will design
against.

### The critical finding: Mermaid exposes its parse result

The converter does not need to reimplement Mermaid's grammars.
`mermaidAPI.getDiagramFromText(text)` returns a diagram object whose database
exposes the parsed structure directly, including `getVertices()` and
`getEdges()` for flowcharts ⟦REVIEW src: github.com/orgs/mermaid-js/
discussions/4399, "Proposal: Add types & typeguards to Diagram & DiagramDb"⟧.
This is exactly how Excalidraw's Mermaid importer works — it calls
`getDiagramFromText`, then reads vertices, edges and clusters off
`diagram.parser.yy` and converts them into its own element skeleton
⟦REVIEW src: docs.excalidraw.com/docs/@excalidraw/mermaid-to-excalidraw/
codebase/parser/flowchart⟧. ⟦REVIEW⟧

That discussion also notes the typing on `Diagram` and `DiagramDb` is thin,
with the internal flow database more capable than its declared interface
⟦REVIEW src: github.com/orgs/mermaid-js/discussions/4399⟧. Expect to write
local type declarations and expect them to be a maintenance cost across
Mermaid versions. ⟦REVIEW⟧

### The critical problem: the parse result has no geometry

Mermaid stores no coordinates; positions are computed at render time. The
Excalidraw importer hits this directly — dimensions and position are absent
from the parser response, so it renders the SVG as well and computes
geometry by reading the rendered output back ⟦REVIEW src:
docs.excalidraw.com/docs/@excalidraw/mermaid-to-excalidraw/codebase/parser/
flowchart⟧. ⟦REVIEW⟧

This gives Ordo two strategies, and the choice is a real fork in the road: ⟦REVIEW⟧

**A. Harvest.** Render the diagram with Mermaid, scrape positions from the
SVG, write them to `.layout.ordo`. Imported diagrams look exactly like the
Mermaid original. Cost: the converter needs a working Mermaid *render*, not
just a parse. ⟦REVIEW⟧

**B. Re-layout.** Take structure only, run your own dagre or ELK pass, write
those positions. Cost: imports do not match the Mermaid original, and a
layout engine enters the dependency tree earlier than planned. Benefit: the
same code path seeds positions for new nodes created in the editor, which is
needed eventually regardless. ⟦REVIEW⟧

### The environment constraint on strategy A

Whether Mermaid runs in plain Node is contested in the sources and must be
tested rather than assumed. Reports conflict: one MCP implementation claims
parse-only validation runs in pure Node in roughly 50ms with rendering
handled by jsdom plus a rasteriser and no Chromium at all ⟦REVIEW src:
glama.ai/mcp/servers/dtrd6ltfeb, mermaid-mcp description⟧, while another
states Mermaid depends on full browser context even for parsing and that
jsdom and happy-dom are insufficient ⟦REVIEW src: glama.ai/mcp/servers/
vtomilin/mermaider⟧. A third account identifies the specific blocker as
`SVGTextElement.getBBox()`, which jsdom does not implement ⟦REVIEW src:
wiki.saltcorn.com/view/ShowPage/server-side-mermaid⟧. There is at least one
package that pre-wires svgdom, jsdom and dompurify specifically to make the
Mermaid API work server-side without a headless browser ⟦REVIEW src:
npmjs.com/package/isomorphic-mermaid⟧. ⟦REVIEW⟧

The `getBBox` account is the most likely explanation and reconciles the
others: text measurement is needed for layout, not for parsing. If that
holds, parse-only works in Node and harvesting does not, without a DOM shim
or a real browser. **Test this in the first week** — it decides strategy A
versus B and it is a half-day spike, not a research project. ⟦REVIEW⟧

### Scope for the first pass

Flowchart only. Not because the others do not matter, but because flowchart
is the one whose model maps to Ordo's without argument, and because it is the
one Excalidraw also started with ⟦REVIEW src: docs.excalidraw.com/docs/
@excalidraw/mermaid-to-excalidraw/codebase/parser⟧. Class, state, ER and C4
follow once the type vocabulary has survived flowchart. ⟦REVIEW⟧

### Work breakdown

- Spike: does `getDiagramFromText` run under plain Node? Under jsdom? Record
  the answer and the error if not.
- Decide harvest versus re-layout on the spike result.
- Build a corpus of Mermaid flowcharts — twenty or so, deliberately including
  subgraphs, labelled edges, multi-directional arrows, and the extended shape
  syntax.
- Map Mermaid shapes to `{type, shape}` pairs. This directly tests the WS3
  cut; anything that will not map is a finding, not a failure.
- Map Mermaid edge forms to edge type plus theme properties.
- Map subgraphs to Container nodes and confirm the containment tree survives.
- Emit an Ordo document set and render it through the WS3 SVG walker.
- Compare against Mermaid's own render. ⟦REVIEW⟧

### Done when

A Mermaid flowchart converts to Ordo files, those files render through the
headless SVG renderer, and the result is recognisably the same diagram. ⟦REVIEW⟧

### What this hands back

- A real corpus for WS1 to design the file format against.
- Whether the flat type vocabulary survives contact with a real shape set.
- The provenance question in its sharpest form: a position that came from
  dagre rather than from a human hand. Is it authored, or derived-until-
  touched? WS1 cannot dodge this once imports exist, and the answer probably
  needs a per-node flag in `.layout.ordo`. ⟦REVIEW⟧

### Explicit non-goal

Mermaid *export*. Round-tripping Ordo back to Mermaid is a separate promise
with different constraints, and making it a goal now would let Mermaid's
expressiveness ceiling dictate Ordo's model. ⟦REVIEW⟧

---

## Workstream 1 — File format and grammar

### Goal

The `.ordo` family: what the files are, what each one owns, and the concrete
syntax. ⟦REVIEW⟧

### Status

Research. The output of this workstream is a specification plus a decision
record, not code. ⟦REVIEW⟧

### The undecided posture

Whether a single-file form exists alongside the split form, and what happens
to it on write. Three positions, unchanged: strict separation; tolerant-
normalising (inline accepted on input, canonicalised on write); first-class
inline (requires a full cascade and provenance tracking). ⟦REVIEW⟧

The deciding question remains whether a single-file diagram stays a single
file after a drag operation. A secondary framing that may be more tractable:
the separable-diff benefit comes from a parser that can classify changes, not
from the filesystem layout. If history is consumed through a UI rather than
raw `git diff`, the file split buys less than it appears to. ⟦REVIEW⟧

### Open questions carried forward

- Identity: who mints node ids, are they human-authored or generated, are
  they stable across a label rename. Ids are load-bearing here in a way they
  are not in HTML, because both edges and layout reference nodes by id.
- Dangling edges: parse error, dropped on load, or preserved and rendered as
  nothing. Tolerance favours agent editing; strictness favours correctness.
- Group coordinates: parent-relative or absolute.
- Anchors: compass points or a named ports model.
- Deletion cascade ownership.
- Node size: authored or derived. Blocked on WS3.
- Per-node style overrides versus semantic states.
- Z-order representation, and whether document order carries it.
- Document order generally: if it renders nothing and is not canonicalised,
  it is a diff hazard.
- Mixed-vocabulary documents: legal, illegal, or governed by a document-level
  profile. ⟦REVIEW⟧

### Done when

A written specification exists, a corpus of hand-authored example files
parses under it, and every open question above has either an answer or an
explicit deferral with a reason. ⟦REVIEW⟧

---

## Workstream 2 — The engine

### Goal

Parse, model, serialise, project, and write back. ⟦REVIEW⟧

### Status

Research, paired with WS1. ⟦REVIEW⟧

### Components

**Parser**: files to in-memory model. **Serialiser**: model to files.
**Projection**: model to React Flow `nodes[]` and `edges[]`, a pure function.
**Write-back**: React Flow change events to model deltas, which is a routing
and filtering problem rather than an inverse function. ⟦REVIEW⟧

### The constraint that shapes everything

React Flow holds no document model. The arrays are the model, supplemented by
an internal store of ephemeral state — viewport, selection, drag state,
measured dimensions. All of it is cache, none of it is truth. That is
favourable: there is no second source of truth to reconcile, and write-back's
entire job is discarding the ephemeral and keeping position and dimension
deltas. ⟦REVIEW⟧

### The test that keeps the grammar honest

Parse then serialise with no edits produces a byte-identical file. Cheap to
write, catches most grammar sins immediately, and is the reason WS1 and WS2
cannot sensibly be sequenced one after the other. ⟦REVIEW⟧

### Done when

Round-trip holds on the WS4 corpus, projection drives the canvas, and a drag
produces a minimal diff in `.layout.ordo` with no change to `.ordo`. ⟦REVIEW⟧

---

## Sequencing note

WS3 and WS4 share a dependency in both directions: WS4 needs WS3's SVG walker
to see its output, WS3 needs WS4's corpus to know whether its type cut holds.
Build the op-list and the Box component first, then start WS4's spike in
parallel — the spike does not depend on WS3 at all. ⟦REVIEW⟧

Both feed WS1 and WS2 with evidence rather than opinion, which is the case
for running them first. The risk to watch is WS4 hardening a provisional file
format by writing emitters against it before WS1 has settled. Mitigation:
have the converter emit the in-memory model and keep serialisation behind one
function, so a format change costs one file rather than a rewrite. ⟦REVIEW⟧
