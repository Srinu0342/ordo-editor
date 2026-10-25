# Sequence diagrams

A sequence diagram is the one diagram where you write the layout as well as
the structure. Its meaning is in where things sit: time runs down the page,
and each message has to be level. Ordo can't work that out from the structure
alone, so lay it out on the grid below. The user can still drag things about
afterwards. Everything on the core page holds except rules 1 to 3: here the
layout carries meaning, so you write it, read it and rewrite it.

The layout is the file's second YAML document: after the structure, a `---`
line, then `ordo-layout: 1`, then `nodes:`, where each node sits, and
`edges:`, which anchor each end of an edge uses. The example at the end shows
it whole.

If the user has the editor open, Import in its header turns a Mermaid
`sequenceDiagram` into an Ordo diagram laid out exactly. When that suits them,
offer the Mermaid too.

## The parts

- **Participant**: a box at the top, with the participant's id, and a copy at
  the bottom with the same label, `<id>-foot`. Use `rect` for a service,
  `person` for an actor and `cyl` for a database.
- **Lifeline**: an edge from the participant to its foot,
  `{ id: <id>-life, from: <id>, to: <id>-foot }`, styled
  `{ line: dashed, width: 1, color: "#94a3b8", end: none, route: straight }`.
- **Track**: a tube that rides the lifeline and draws nothing; it holds the
  ends of the messages. One per participant:
  `<id>-track: { kind: tube, variant: track, attach: <id>-life, taps: [...] }`.
- **Activation bar**: a tube riding the lifeline while the participant is busy:
  `{ kind: tube, attach: <id>-life, taps: [...] }`.
- **Message**: an edge from the sender's tube to the receiver's. At a row where
  a participant has a bar, its end is on the bar; otherwise on its track. Give
  every message `route: straight, placement: above`.
- **Frame**: `{ kind: fragment, operator: alt, guards: [...], dividers: [...] }`.
  The operator is `loop`, `alt`, `opt`, `par`, `critical` or `break`; there is
  one guard per section, and a divider for each `else`. A `loop`, `opt` or
  `break` has one section: one guard and `dividers: []`. Write guards without
  brackets; Ordo draws them. `operator: rect` draws
  a shaded band instead, with no tab and no guards, coloured by `fill`.
- **Note**: a box with `shape: note`.

`taps` are where messages meet a tube, in px down from the tube's top,
smallest first. A message names a tap by its place in that list. In the
layout, a tube's `t` puts its centre that fraction of the way down its
lifeline: 0 at the top, 1 at the bottom.

## Messages

| Mermaid | Ordo `data.edges.<id>` |
|---|---|
| `A->>B` call | nothing more: the end is an `arrow` |
| `A-->>B` reply | `line: dashed` |
| `A-)B` async | `end: open-arrow` |
| `A-xB` | `end: cross` |
| `A->B` | `end: none` |

## The grid

Number the rows from 1, top to bottom. Each message, note, frame opening
(`loop`, `alt` …), `else` and `end` takes the next row; a message to itself
takes two. Starting and ending an activation takes none. With N rows in all:

- Row n's line is at y = 48 + 40n.
- Participant i, counting from 0 at the left, is centred at cx = 240i + 80.
- The feet are at y = 80 + 40N, and every lifeline is L = 26 + 40N long.

Layout, after `---`:

| Node | Layout entry |
|---|---|
| participant i | `{ x: 240i, y: 0 }`; add `w: 160, h: 48` if its shape isn't `rect` |
| its foot | `{ x: 240i, y: 80 + 40N }`, with the same `w` and `h` |
| track | `{ x: cx − 2, y: 51, w: 4, h: L, t: 0.5, angle: 90 }` |
| bar from row a to row b | `{ x: cx − 7, y: 40 + 40a, w: 14, h: 40(b − a) + 16, t: (20(a + b) − 3) / L, angle: 90 }`, t to four places |
| frame from row a (its opening) to row b (its `end`) | `{ x: cx₁ − 40, y: 28 + 40a, w, h: 40(b − a) }` |
| note at row n | `{ x: cx − 75, y: 24 + 40n, w: 150, h: 32 }` |
| lifeline | `{ from: bottom, to: top }` |
| message | `{ from: <side><k>, to: <side><k>, z: 2 }` |

And the structure's numbers:

- A track's taps: 40n − 3 for each row n where a message leaves or reaches the
  participant outside its bars.
- A bar's taps, for a bar from row a: 40(n − a) + 8 for each of its rows n.
- A frame's dividers: 40(e − a) + 8 for each `else` at row e.
- A frame spans the participants its messages touch, from centre cx₁ to cx₂.
  Its width w is the largest of: cx₂ − cx₁ + 80; 8 × (the characters in its
  operator plus those in its first guard, counting spaces) + 50; and, for a
  message to itself inside it, enough to hold that label (see below).

A message's ends: the sender leaves from side `b`, the tube's right, when the
receiver is to its right, and from side `a`, its left, when the receiver is to
its left. The receiver takes the other side. k is the index of that row's tap
in the tube's `taps`, from 0. `z: 2` draws the message over the bars.

A message to itself leaves at its row and comes back at the next, both on side
`b` of the same tube. In the structure it runs from that tube to itself,
`{ id: retry, from: auth-bar, to: auth-bar }`, with
`route: step, placement: right`; in the layout,
`{ from: b<k>, to: b<k+1>, z: 2 }`. Its label hangs to the right of the lifeline:
allow 8 px a letter plus 60 from cx, and widen a frame round it to match.

Columns 240 px apart fit message labels of about 24 characters. For longer
ones, use a wider spacing, the same for every column, in place of 240.

`validate_ordo` warns about a message that names a tap its tube doesn't have
(the message isn't drawn), taps out of order, and guards that don't match the
dividers. It can't check the arithmetic: a message on the wrong row, or a `t`
worked out wrong, still validates. So work each number out from the grid.

## Example

A customer signs in. The rows: 1 Sign in, 2 POST /login, 3 Find user,
4 User row, 5 `alt`, 6 Token, 7 `else`, 8 401, 9 `end`, 10 the note,
11 Welcome. So N = 11, the feet are at 520 and L = 466. Auth API is busy from
row 2 to row 8.

```yaml
ordo: 1
nodes:
  - user
  - user-foot
  - app
  - app-foot
  - auth
  - auth-foot
  - db
  - db-foot
  - user-track
  - app-track
  - auth-track
  - db-track
  - auth-bar
  - check
  - keep
edges:
  - { id: user-life, from: user, to: user-foot }
  - { id: app-life, from: app, to: app-foot }
  - { id: auth-life, from: auth, to: auth-foot }
  - { id: db-life, from: db, to: db-foot }
  - { id: m1, from: user-track, to: app-track }
  - { id: m2, from: app-track, to: auth-bar }
  - { id: m3, from: auth-bar, to: db-track }
  - { id: m4, from: db-track, to: auth-bar }
  - { id: m5, from: auth-bar, to: app-track }
  - { id: m6, from: auth-bar, to: app-track }
  - { id: m7, from: app-track, to: user-track }
data:
  nodes:
    user: { label: Customer, shape: person }
    user-foot: { label: Customer, shape: person }
    app: { label: App }
    app-foot: { label: App }
    auth: { label: Auth API }
    auth-foot: { label: Auth API }
    db: { label: Users DB, shape: cyl }
    db-foot: { label: Users DB, shape: cyl }
    user-track: { kind: tube, variant: track, attach: user-life, taps: [37, 437] }
    app-track: { kind: tube, variant: track, attach: app-life, taps: [37, 77, 237, 317, 437] }
    auth-track: { kind: tube, variant: track, attach: auth-life, taps: [] }
    db-track: { kind: tube, variant: track, attach: db-life, taps: [117, 157] }
    auth-bar: { kind: tube, attach: auth-life, taps: [8, 48, 88, 168, 248] }
    check: { kind: fragment, operator: alt, guards: [password matches, wrong password], dividers: [88] }
    keep: { label: Token kept 1 hour, shape: note }
  edges:
    user-life: { line: dashed, width: 1, color: "#94a3b8", end: none, route: straight }
    app-life: { line: dashed, width: 1, color: "#94a3b8", end: none, route: straight }
    auth-life: { line: dashed, width: 1, color: "#94a3b8", end: none, route: straight }
    db-life: { line: dashed, width: 1, color: "#94a3b8", end: none, route: straight }
    m1: { label: Sign in, route: straight, placement: above }
    m2: { label: POST /login, route: straight, placement: above }
    m3: { label: Find user, route: straight, placement: above }
    m4: { label: User row, line: dashed, route: straight, placement: above }
    m5: { label: Token, line: dashed, route: straight, placement: above }
    m6: { label: "401", line: dashed, route: straight, placement: above }
    m7: { label: Welcome, route: straight, placement: above }
---
ordo-layout: 1
nodes:
  user: { x: 0, y: 0, w: 160, h: 48 }
  user-foot: { x: 0, y: 520, w: 160, h: 48 }
  app: { x: 240, y: 0 }
  app-foot: { x: 240, y: 520 }
  auth: { x: 480, y: 0 }
  auth-foot: { x: 480, y: 520 }
  db: { x: 720, y: 0, w: 160, h: 48 }
  db-foot: { x: 720, y: 520, w: 160, h: 48 }
  user-track: { x: 78, y: 51, w: 4, h: 466, t: 0.5, angle: 90 }
  app-track: { x: 318, y: 51, w: 4, h: 466, t: 0.5, angle: 90 }
  auth-track: { x: 558, y: 51, w: 4, h: 466, t: 0.5, angle: 90 }
  db-track: { x: 798, y: 51, w: 4, h: 466, t: 0.5, angle: 90 }
  auth-bar: { x: 553, y: 120, w: 14, h: 256, t: 0.4227, angle: 90 }
  check: { x: 280, y: 228, w: 320, h: 160 }
  keep: { x: 245, y: 424, w: 150, h: 32 }
edges:
  user-life: { from: bottom, to: top }
  app-life: { from: bottom, to: top }
  auth-life: { from: bottom, to: top }
  db-life: { from: bottom, to: top }
  m1: { from: b0, to: a0, z: 2 }
  m2: { from: b1, to: a0, z: 2 }
  m3: { from: b1, to: a0, z: 2 }
  m4: { from: a1, to: b2, z: 2 }
  m5: { from: a3, to: b2, z: 2 }
  m6: { from: a4, to: b3, z: 2 }
  m7: { from: a4, to: b1, z: 2 }
```

## Changing a sequence diagram

Adding or removing a row moves everything below it. Number the rows again,
work out the layout by the grid, and write the whole file, keeping every id.
If the user has moved things by hand, tell them this puts the diagram back on
the grid.
