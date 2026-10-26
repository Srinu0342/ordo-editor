# Flowcharts

A flowchart is steps joined by arrows in the order they happen, with
decisions where the path splits, lines back to an earlier step, and paths
that meet again. Everything on the core page and topic `layout` still holds;
this page says which shape means what, where each piece goes, and which sides
its lines use.

## Shapes

| The step | `shape` |
|---|---|
| Start and end | `stadium`, labelled `Start` and `End`; or `sm-circ` and `fr-circ`, which show no label. Use one pair in a diagram. |
| An action | `rect` |
| A decision | `diam`, labelled with a short question: `Paid?`, `"New\nemail?"` |
| Input or output: a form filled in, a file read, a message sent | `lean-r` |
| A step drawn as a flowchart of its own | `fr-rect` |
| A document made | `doc`, or `docs` for several |
| Data kept | `cyl` |
| Waiting | `delay` |
| Done by hand | `trap-t`; typed in by hand, `sl-rect` |
| Getting ready | `hex` |
| Shown on a screen | `curv-trap` |
| Paths that run at the same time start and finish | `fork` |
| A comment on a step | `brace` beside it, or a text node |

A `diam` holds a word or two: the shape list on the core page says how much
fits. Break a longer question with `\n`, or shorten it. Write the question so
its answers are short, like `yes` and `no`.

## The main path

Pick the path most cases take, and run it down one column, from start to end.
Everything else branches off it to the side.

- Centre the main column on one x, cx. Place each node in it from its centre,
  x = cx − w / 2, so the lines between them run straight. Topic `layout` has
  every shape's size.
- Leave 64 px between the bottom of one node and the top of the next one down
  the column: room for a `yes` on the line between them.
- Put side columns 240 px from the main one, centre to centre.
- Left to right works the same way along a row: centre the nodes on one y,
  leave 80 px between one node and the next, and put branches in a row 80 px
  below.

## Decisions

- Label each line out of a decision with its answer: `yes` and `no`, or what
  was chosen, such as `card` and `cash`. Quote `"yes"` and `"no"`. Most other
  lines in a flowchart need no label.
- The answer most cases take carries on down the main column, out of the
  decision's bottom. Another goes out of its side, to a node in the side
  column level with it: the same centre, y = cy − h / 2. With three answers,
  use both sides.
- Ordo picks those sides by itself while the nodes are lined up like that.
  Pin `{ from: bottom, to: top }` on a line down to a node not in its own
  column, as topic `layout` says.

## Loops

A line back to an earlier step goes round the outside:

- From a node in a side column: pin `{ from: top, to: right }`, or `left` on
  the left. The line runs up the side column and into the side of the step it
  goes back to.
- From the main column to a step above it: pin `{ from: left, to: left }`.
  The line loops out to the left and comes back in. Keep the space beside the
  column clear between the two.
- Left to right: from a node in the row below, pin `{ from: left, to: bottom }`:
  the line runs back under the row and up into the step.

## Paths that meet again

- Lines into one side of a node all arrive at its middle, so two paths
  joining a step meet there.
- A side branch that rejoins the main path further down: pin
  `{ from: bottom, to: right }`, or `left`. The line runs down the side column
  and turns into the side of the step. Keep that column clear below the branch.
- Two paths that end in the same place may each have an end of their own
  instead, beside where they finish, to save a long line.

## Paths at the same time

Open them with a `fork` bar and close them with another, in the main column:

- Make each bar as wide as the paths under it, with both `w` and `h` in the
  layout: `{ x: 120, y: 368, w: 400, h: 14 }`. A `w` without an `h` is ignored.
- Put the paths in columns under the bar, their tops level, and centre the
  bar on the main column.
- Pin each line to and from the bars `{ from: bottom, to: top }`. The lines
  leave the middle of the first bar and spread out, and come back together on
  the second.

## Swimlanes

Lanes show who does each step: one group per person, team or system.

- Put the lanes side by side, 80 px apart, all at the same y, and give each
  the same `w` and `h`, both of them. A label on a line between two lanes sits
  halfway along it, so in a narrower gap it lands on a lane's border.
- A lane 240 px wide holds a column of 160 px boxes, 40 px in from each side.
  For two columns in a lane, make it 480 px.
- Make the lanes as tall as the lowest node in any of them, plus 24 px or more.
- Work out every node's place on the whole canvas first, with the rules
  above: the main path is the flow, wherever its lanes are. Then, for each
  node, take away its lane's x and y.
- A line into another lane at a later step: pin `{ from: right, to: top }`, or
  `left`. It runs across and turns down into the step. A line to a node level
  with it, in any lane, needs no pins.
- Left to right, the lanes are rows, one under another, 80 px apart.

## Example: signing up

The main column is centred at x = 320 and the side column at x = 560, with
64 px between nodes down the main column. `Show errors` and `Offer sign-in`
sit level with their decisions. The line back from `Show errors` runs up into
the side of `Read form`, and `Offer sign-in` runs down to `End` and turns into
its side.

```yaml
ordo: 1
nodes:
  - start
  - form
  - valid
  - fix
  - known
  - create
  - signin
  - welcome
  - end
edges:
  - { id: e1, from: start, to: form }
  - { id: e2, from: form, to: valid }
  - { id: valid-no, from: valid, to: fix }
  - { id: retry, from: fix, to: form }
  - { id: valid-yes, from: valid, to: known }
  - { id: new-yes, from: known, to: create }
  - { id: new-no, from: known, to: signin }
  - { id: e3, from: create, to: welcome }
  - { id: e4, from: welcome, to: end }
  - { id: e5, from: signin, to: end }
data:
  nodes:
    start: { label: Start, shape: stadium }
    form: { label: Read form, shape: lean-r }
    valid: { label: Valid?, shape: diam }
    fix: { label: Show errors }
    known: { label: "New\nemail?", shape: diam }
    create: { label: Create account }
    signin: { label: Offer sign-in }
    welcome: { label: Welcome email, shape: doc }
    end: { label: End, shape: stadium }
  edges:
    valid-no: { label: "no" }
    valid-yes: { label: "yes" }
    new-yes: { label: "yes" }
    new-no: { label: "no" }
---
ordo-layout: 1
nodes:
  start: { x: 240, y: 0 }
  form: { x: 235, y: 112 }
  valid: { x: 250, y: 224 }
  fix: { x: 480, y: 244 }
  known: { x: 250, y: 376 }
  create: { x: 240, y: 528 }
  signin: { x: 480, y: 396 }
  welcome: { x: 240, y: 640 }
  end: { x: 240, y: 768 }
edges:
  retry: { from: top, to: right }
  e5: { from: bottom, to: right }
```

## Example: swimlanes

Three lanes, 240 px wide and 80 px apart, at x = 0, 320 and 640. Every box is
40 px in from its lane's side, and the decision 50 px, so each is centred in
its lane. `Get refund` and `Receive parcel` sit level with the steps that lead
to them; the other lines into a new lane are pinned right to top.

```yaml
ordo: 1
nodes:
  - customer:
      - place
      - refund
      - receive
  - shop:
      - stock
      - charge
  - warehouse:
      - pack
      - ship
edges:
  - { id: e1, from: place, to: stock }
  - { id: no-stock, from: stock, to: refund }
  - { id: in-stock, from: stock, to: charge }
  - { id: e2, from: charge, to: pack }
  - { id: e3, from: pack, to: ship }
  - { id: e4, from: ship, to: receive }
data:
  nodes:
    customer: { label: Customer }
    shop: { label: Shop }
    warehouse: { label: Warehouse }
    place: { label: Place order }
    refund: { label: Get refund }
    receive: { label: Receive parcel }
    stock: { label: In stock?, shape: diam }
    charge: { label: Charge card }
    pack: { label: Pick and pack }
    ship: { label: Ship parcel }
  edges:
    no-stock: { label: "no" }
    in-stock: { label: "yes" }
    e4: { label: courier }
---
ordo-layout: 1
nodes:
  customer: { x: 0, y: 0, w: 240, h: 624 }
  shop: { x: 320, y: 0, w: 240, h: 624 }
  warehouse: { x: 640, y: 0, w: 240, h: 624 }
  place: { x: 40, y: 56 }
  refund: { x: 40, y: 176 }
  receive: { x: 40, y: 540 }
  stock: { x: 50, y: 156 }
  charge: { x: 40, y: 308 }
  pack: { x: 40, y: 428 }
  ship: { x: 40, y: 540 }
edges:
  e1: { from: right, to: top }
  e2: { from: right, to: top }
```

## Changing a flowchart

To put a step into the main path, move every node below it down by the new
node's height plus 64 px, with the side columns beside them, and tell the
user you moved them. Topic `editing` has the rest.
