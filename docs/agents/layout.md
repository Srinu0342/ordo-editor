# Laying out a diagram

You decide where everything goes. Ordo can place a node you leave without a
position, top to bottom along the edges, but it doesn't know what the diagram
means: it puts a fan-out in one long row, runs lines through boxes, and drops
labels on top of each other. So give every node a position, then look at the
diagram with `render_ordo` and fix what reads badly. Everything on the core
page still holds. For a sequence diagram, use the grid in topic `sequence`.

## The loop

1. Sketch it first: which way the diagram flows, what goes in each row or
   column, and which nodes share a group.
2. Write the structure and the layout together, in one file.
3. Call `validate_ordo` until it reports no errors.
4. Call `render_ordo` and look for boxes that overlap, lines that run through
   a box, labels on top of each other or on a box, text that is cut off, and
   a line that seems to go somewhere it doesn't.
5. Move nodes, pin the sides edges use, shorten labels, and draw it again.
   Expect two or three rounds.

## The layout

The layout is the file's second YAML document: after the structure, a `---`
line, then:

```yaml
ordo: 1
nodes:
  - api
  - db
edges:
  - { id: e1, from: api, to: db }
---
ordo-layout: 1
nodes:
  api: { x: 0, y: 0 }
  db: { x: 200, y: 120 }
edges:
  e1: { from: bottom, to: top }
```

- `nodes`: one entry per node, every node in the structure, groups included.
  `x` and `y` are its top-left corner in whole px, with y growing down. A node
  in a group is placed from the group's top-left corner, not the canvas's.
- `w` and `h` set a size other than the default. Leave them out unless a label
  needs more room, or a group needs to be bigger than its children. Give both:
  a `w` without an `h`, or an `h` without a `w`, is ignored.
- `edges`: which side of a node each end of an edge uses, `top`, `right`,
  `bottom` or `left`. Leave out an edge whose sides Ordo picks well; see
  Sides.
- Nothing else goes in the layout: no labels, no styles.

## Sizes

A node's size is where its edges end and how much room it takes. Shapes, as
they are dropped, w × h in px:

{{list:sizes}}

The other kinds:

{{list:kindSizes}}

The shape list on the core page says how much label fits in each shape. A
label that doesn't fit is cut off: give the box a bigger `w`, break the label
with `\n`, or shorten it.

## A grid

Line nodes up by their centres, on columns and rows:

- Columns 240 px apart and rows 120 px apart suit 160 × 48 boxes with short
  labels on the lines between them. Widen a gap to fit the labels in it: a
  label between two columns needs its own width plus 40 px of gap.
- Place a node from its centre: x = cx − w / 2 and y = cy − h / 2. Nodes in
  one column then join with straight lines.
- In a row that edges come into from above, line up the tops, not the
  centres: each line's bend then sits at the same height, and the lines read
  as one fan-out.
- Work out every node's place on the whole canvas first. Then, for a node in a
  group, take away the group's x and y.

## Groups

- A group is a frame round its children. Put its first child {{list:groupPad}}
  px in from its left and {{list:groupTop}} px down from its top: the title
  sits on the top border and takes the space above.
- Leave a group's `w` and `h` out and it fits its children, {{list:groupPad}}
  px past the rightmost and the lowest. So place the group at the top-left
  child's canvas position, less {{list:groupPad}} across and {{list:groupTop}}
  down, and its children at {{list:groupPad}} or more across and
  {{list:groupTop}} or more down.
- Keep 40 px between two groups, and between a group and a node outside it.
  Where labelled lines run between two groups, keep 80 px or more: a `step`
  line turns halfway between its ends, and its label sits on that turn, so in
  a narrow gap the label lands on a frame's border. Put a node whose lines
  leave the group against the side of the group they leave by, so its labels
  sit in the open space between the frames.
- A line from outside a group to a node in it crosses the group's top border.
  Keep it clear of the title, which runs from 12 px in along the border (its
  length is in Sizes): put the group's first column further in, or bring the
  line in from the side.

## Direction

Pick one direction and keep to it: top to bottom for most flows and for
architecture, with callers at the top and stores at the bottom; left to right
for a pipeline or a long chain of steps. Point every edge the way things flow.
An edge that runs back, such as a retry or a reply, goes round the outside:
pin it `right` to `right`, and it loops out to the side.

## Sides

An edge with no sides pinned leaves from the side of its node that faces the
other node. Ordo measures the distance across and the distance down between
the two centres, and the bigger one decides. So a node that is below another
but further across than down is joined side to side: the line leaves from the
side and runs along the row. When a node fans out to a row of nodes below it,
the outer ones are joined like that, and the line passes the nodes in between,
so it reads as a chain that isn't there.

Pin the sides in the layout's `edges` to stop it:

- Top to bottom: `{ from: bottom, to: top }` on each edge that goes down to a
  node not in its own column.
- Left to right: `{ from: right, to: left }` on each edge that goes across to
  a node not in its own row.
- Leave out edges between nodes in one column or one row: Ordo picks those
  sides well.
- A pin may turn a corner: `{ from: bottom, to: left }` goes down out of one
  node and into the side of another, with one bend. Use it to come into a
  node from the side rather than through the nodes above it.

## Lines and labels

- Lines don't go round nodes. A line between two nodes runs through any node
  between them. Keep the space between two joined nodes clear, or move one of
  them.
- A `step` line, the default, leaves its node straight out, turns halfway to
  the other node, and turns again to arrive straight in. Every line out of
  one node down to a row turns at the same height, so they share that stretch.
- A label sits at the middle of its line: halfway between the two ends, on a
  `step` line too, where it is on the stretch where the line turns. Ordo never
  moves a label out of the way of another label or a node.
- So in a fan-out from one node down to a row, the labels sit side by side on
  the shared stretch, each halfway between the source and its target: half as
  far apart as the targets are. Space the targets at least twice the widest
  label apart, and leave the label off the line that goes straight down: it
  would sit right where the lines split.
- A fan-out with long labels reads better sideways: put the targets in a
  column to one side, and give each edge `route: straight` and the pins
  `{ from: right, to: left }`. The labels then stack, half a row apart, so
  space the targets a row of 100 px or more apart, and make each line at least
  twice as long as its label.
- `placement: above` puts the label above the middle of the line, and
  `right` puts its left edge just right of the middle. On a straight line
  across, `above` keeps the line whole; on a line down, `right` puts the label
  beside it. On a line across, `right` lays the label along the line to the
  right, towards whatever is next: give it room there, or use the default.
- Keep labels to a word or three, and count capitals as wider letters. Put
  more in a text node beside the diagram.

## Recipes

- **Flowchart**: top to bottom, the main path down one column, and branches
  in the columns either side. Topic `flowchart` has the whole recipe:
  decisions, loops, paths that meet again, parallel paths and swimlanes.
- **Architecture**: rows from top to bottom: who calls it, the way in, the
  services, and the stores and outside systems. Draw each system as a group
  and lay its nodes on the grid inside it. Put the groups of one row side by
  side, 40 px apart, or 80 px or more where labelled lines cross between them.
  A group of dependencies can sit beside the service that calls it, with the
  calls running across.
- **Class or ER diagram**: parents and wholes above, children and parts below,
  as topic `class` writes the edges. Rows are as far apart as the tallest
  class in the row plus 80 px. Columns 260 px apart leave room for the
  multiplicity labels.

## Example

A customer orders through a web shop, which saves the order, publishes an
event and takes payment. Columns are centred at x = 160, 400 and 640, and rows
at y = 48, 216 and 336, with the stores' tops at 440. The web shop group sits
at the top-left child's place, (320, 192), less 24 across and 56 down. The two
edges to the outer stores are pinned bottom to top; unpinned, they would leave
the API from its sides.

```yaml
ordo: 1
nodes:
  - title
  - customer
  - shop:
      - web
      - api
  - db
  - queue
  - payments
edges:
  - { id: browse, from: customer, to: web }
  - { id: order, from: web, to: api }
  - { id: save, from: api, to: db }
  - { id: publish, from: api, to: queue }
  - { id: charge, from: api, to: payments }
data:
  nodes:
    title: { kind: text, label: Placing an order, textSize: 20, textWeight: bold }
    customer: { label: Customer, shape: person }
    shop: { label: Web shop }
    web: { label: Storefront, shape: rounded }
    api: { label: Orders API }
    db: { label: Orders DB, shape: cyl }
    queue: { label: Order events, shape: h-cyl }
    payments: { label: Payments }
  edges:
    browse: { label: browses, placement: right }
    order: { label: POST /orders, placement: right }
    save: { label: save }
    publish: { line: dashed }
    charge: { label: charge }
---
ordo-layout: 1
nodes:
  title: { x: 0, y: 0 }
  customer: { x: 352, y: 0 }
  shop: { x: 296, y: 136 }
  web: { x: 24, y: 56 }
  api: { x: 24, y: 176 }
  db: { x: 90, y: 440 }
  queue: { x: 300, y: 440, w: 200, h: 76 }
  payments: { x: 560, y: 440 }
edges:
  save: { from: bottom, to: top }
  charge: { from: bottom, to: top }
```
