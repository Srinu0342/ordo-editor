# Writing Ordo diagrams

Ordo is a diagram editor whose diagrams are YAML files in the repo they
describe. You write the file and the editor draws it. This page covers
flowcharts, architecture and other box-and-arrow diagrams. The topic pages
listed at the end cover the rest.

## The file

A diagram is one file, `<repo>/.ordo/<name>/ordo.yaml`. The folder's name is
the diagram's name, and its tab in the editor. Names use letters, digits,
spaces, `-`, `_` and `.`, start with a letter or digit, and run to 64
characters: `.ordo/checkout-flow/ordo.yaml`.

The file holds the structure, which you write. After a `---` line the editor
keeps the layout: where everything sits. A new file is the structure alone.

If the user has the repo open in Ordo, a new diagram appears as a tab within
about ten seconds, and changes to an open one load by themselves.

## Steps

1. Write the structure, as below.
2. Call `validate_ordo` with the file's `path`. Fix every error it lists and
   call it again, until it reports none. Read its warnings too.
3. Tell the user the diagram's name.

## The structure

```yaml
ordo: 1                    # always the first line
nodes:                     # every node, as a tree of ids
  - user                   # a node
  - shop:                  # a group: an id with its children under it
      - web
      - api
edges:                     # who connects to whom
  - { id: e1, from: user, to: web }
  - { id: e2, from: web, to: api }
data:                      # what each node and edge says and looks like
  nodes:
    user: { label: Customer, shape: person }
    shop: { label: Web shop }
  edges:
    e1: { label: browses }
```

- `nodes` holds ids and nothing else. A bare id is a node; an id with a list
  under it is a group, drawn as a frame round its children. Groups nest.
- Each entry in `edges` has exactly `id`, `from` and `to`. Either end may be a
  group.
- Everything else goes in `data.nodes.<id>` and `data.edges.<id>`. Leave out
  what you don't need: a node with no data is a box labelled with its id, and
  an edge with no data is a plain arrow. `edges` and `data` may be left out.
- An id is any text, used once: nodes and edges share one set. Pick short ids
  that will last, like `orders-db`. The label is what the user reads.

## Nodes

`kind` says what a node is: {{list:kinds}}; `box` when it is left out. A group
has no `kind`: it is a group because it has children. Every node may have:

- `label`: the text it shows. Default: its id (a tube or fragment shows none).
- `type`: what the thing is, as lower-case words joined by `/` and `-`, like
  `store/postgres` or `queue/kafka`. There is no fixed list, and it changes
  nothing on the canvas; it tells readers and tools what the box stands for.

**box**, the default kind: a shape with a label in it.

- `shape`: one of the shapes below. Default `rect`.
- `textSize` ({{list:textSizes}} px) and `textWeight` ({{list:weights}}) restyle the
  label. Default: what the shape draws in, 16 px semibold for most shapes.
- A label is one line. Nothing wraps: break it yourself with `\n` inside
  double quotes, `label: "Orders\nAPI"`. Text that runs past the shape's edge
  is cut off. The shape list below says how much fits in each shape; a `diam`
  holds a word or two, such as `Paid?`. Put longer text in a text node.

**group**: a frame round its children, with its label in a band along the top.

- `label` and `type`, like any node, and `textSize` and `textWeight`, as for a
  box.
- The Mermaid importer writes `collapsed`, `members` and `mermaid` on groups.
  Keep them where you find them, and don't add them.

**text** (`kind: text`): words with no frame, as big as the words. Use it for
a title, a note or a legend.

- `label` may run to several lines: write `label: |` and indent the lines
  under it.
- `textSize`, `textWeight` and `textAlign` ({{list:aligns}}). Default 16 px,
  regular, `left`.

**class** (`kind: class`): a UML class or ER entity, a name over compartments
of rows. See topic `class`.

**tube** (`kind: tube`): an activation bar riding a lifeline in a sequence
diagram. See topic `sequence`.

**fragment** (`kind: fragment`): a loop, alt, opt or par frame in a sequence
diagram. See topic `sequence`.

## Shapes

`shape` takes a key. In brackets: the palette's name for it, where the key
doesn't say, and how much label fits at its usual size. `15 × 2` is about 15
characters a line, on two lines; `no label` means the shape shows none. A
smaller `textSize` fits more: at 12 px, about a third more.

{{list:shapes}}

Common picks: `rect` for a service, step or component; `rounded` for an event;
`diam` for a decision; `cyl` for a database; `h-cyl` for a queue or stream;
`doc` for a document; `person` for a user; `cloud` for the internet or an
outside system; `sm-circ` and `fr-circ` for start and stop. Mermaid's long names, such as `cylinder`,
`database` and `diamond`, are accepted, but write the key.

## Edges

`data.edges.<id>` takes these fields. Defaults are in brackets.

- `label`: text on the line [none].
- `line`: {{list:lines}} [`solid`]. `thick` is a solid line 3 px wide.
- `width`: the line's width in px [1.5, or 3 for `thick`].
- `color`: any CSS colour [{{list:color}}]. Quote a hex colour,
  `color: "#16a34a"`: an unquoted `#` starts a YAML comment.
- `start` and `end`: the marker at the `from` end and at the `to` end
  [`none` and `arrow`]. Markers: {{list:markers}}. `arrow` is a filled head and
  `open-arrow` an open one. The UML and ER markers are explained on topic
  `class`.
- `route`: {{list:routes}} [`step`]. `step` is right angles with rounded corners,
  `orthogonal` right angles with sharp ones, `straight` a direct line, and
  `curved` a smooth curve.
- `placement`: where the label sits: {{list:placements}} [`center`].
- `textSize` and `textWeight`: the label's text [13 px, `regular`].
- `hidden`: `true` draws nothing but still counts for layout [`false`].

## Layout

You never write positions. When Ordo opens a file that has no layout, it lays
out each group, and then the canvas, top to bottom along the edges: an edge
from `a` to `b` puts `b` below `a`. So list nodes in reading order and point
edges the way things flow. An edge that points back up the flow, such as a
retry loop, crosses the others; draw one only when the diagram needs it. An
edge from outside a group to a node inside it has its label on the group's
title; give that edge `placement: right`. To put one node below another without drawing a line,
join them with a `hidden: true` edge. The user tidies the rest by hand, and
the editor saves where everything ended up.

## Example

```yaml
ordo: 1
nodes:
  - customer
  - shop:
      - web
      - api
      - paid
  - db
  - mailer
edges:
  - { id: browse, from: customer, to: web }
  - { id: order, from: web, to: api }
  - { id: charge, from: api, to: paid }
  - { id: save, from: paid, to: db }
  - { id: receipt, from: paid, to: mailer }
data:
  nodes:
    customer: { label: Customer, shape: person }
    shop: { label: Web shop }
    web: { label: Storefront, shape: rounded }
    api: { label: Orders API }
    paid: { label: Paid?, shape: diam }
    db: { label: Orders DB, shape: cyl, type: store/postgres }
    mailer: { label: Email service, type: service/email }
  edges:
    browse: { label: browses, placement: right }
    order: { label: POST /orders, route: straight }
    save: { label: "yes", line: thick }
    receipt: { label: sends receipt, line: dashed, color: "#16a34a" }
```

## Rules

1. **Leave out the layout.** Write the structure and stop. Ordo places what
   has no position, and coordinates you guess would only be in the way. (A
   sequence diagram is the one exception; see its topic.)
2. **Read only up to `---`.** What follows it is positions and sizes for the
   editor. It is long, and nothing in it changes what the diagram says.
3. **Never edit below `---`.** That part is the user's arrangement, and the
   editor writes it. Leave stale lines there too: one for a node you removed
   is dropped on the next save.
4. **Keep ids stable.** Positions are filed under ids. To rename something,
   change its `label`; a new id is a new node, and it loses its place.
5. **Quote what YAML would misread.** Quote a value that holds `: ` or ` #`,
   or that starts with `#`, `&`, `*`, `!`, `|`, `>`, `@`, `%`, `[`, `{`, or a
   quote mark. Quote an id or label that would read as a number, `true`,
   `false` or `null`: `"404"`. Ordo reads YAML 1.2, so `yes`, `no`, `on` and
   `off` are text already.
6. **Check before you finish.** Run `validate_ordo` on the file and fix every
   error. A warning doesn't stop the diagram opening, but read each one: a
   line left in the layout for a node you removed can stay, while an edge that
   isn't drawn needs fixing.

## Topics

Call `ordo_guide` again with `topic` set to one of these:

- `sequence`: before a sequence diagram: participants, lifelines, activation
  bars, messages, loop and alt frames, notes.
- `class`: before a UML class diagram or an ER diagram: class boxes with
  compartments, and the UML and crow's-foot markers.
- `editing`: before you change a diagram that already exists: what to keep,
  where new nodes land, and how the editor picks up your change.
- `mermaid`: when you are given Mermaid, or think in it: how each Mermaid
  piece maps onto Ordo.
