# From Mermaid to Ordo

Read the Mermaid for what is there and what connects to what, then write the
Ordo file directly. Leave Mermaid's layout behind: Ordo lays the diagram out
itself, top to bottom, and the user arranges it from there. Everything on the
core page still holds.

## Flowcharts

`flowchart TD` or `LR` says nothing Ordo needs. Keep Mermaid's node ids as
the Ordo ids. Mermaid's edges have no ids, so give each one a short id of
your own (`e1`, `e2` … or `api-db`).

| Mermaid | Ordo `shape` |
|---|---|
| `A[text]` | `rect`, the default |
| `A(text)` | `rounded` |
| `A([text])` | `stadium` |
| `A[[text]]` | `fr-rect` |
| `A[(text)]` | `cyl` |
| `A((text))` | `circle` |
| `A(((text)))` | `dbl-circ` |
| `A>text]` | `odd` |
| `A{text}` | `diam` |
| `A{{text}}` | `hex` |
| `A[/text/]` | `lean-r` |
| `A[\text\]` | `lean-l` |
| `A[/text\]` | `trap-b` |
| `A[\text/]` | `trap-t` |
| `A@{ shape: doc }` | `doc`: Mermaid's shape names are Ordo keys, or names Ordo accepts for them |

The text in the brackets is the `label`. A `<br>` in it becomes `\n`, inside
a double-quoted label.

| Mermaid | Ordo edge, with `data.edges.<id>` |
|---|---|
| `A --> B` | `{ id: e1, from: A, to: B }`, nothing more |
| `A --- B` | `end: none` |
| `A -.-> B` | `line: dotted` |
| `A ==> B` | `line: thick` |
| `A --o B` | `end: circle` |
| `A --x B` | `end: cross` |
| `A <--> B` | `start: arrow` |
| `A ~~~ B` | `hidden: true` |
| `A --> B & C`, `A --> B --> C` | one edge per pair |

Text on a link, `A -- text --> B` or with the text between pipes after the
arrow, is the edge's `label`.

- `subgraph id [Title] … end` is a group: `id` in `nodes` with the
  subgraph's nodes listed under it, and `label: Title`. An id appears once in
  `nodes`, so a node Mermaid lists in two subgraphs goes in one group. An edge
  to a subgraph is an edge to the group.
- `linkStyle 3 stroke:#f66,stroke-width:3px` sets `color` and `width` on the
  fourth edge.
- `style`, `classDef` and `class` colour nodes, which Ordo boxes don't have:
  leave them out, with `click` lines and `%%` comments.

## Sequence diagrams

Read topic `sequence`, and translate participants, messages, activations,
notes and blocks as it shows. If the user has the editor open, Import (in the
header) turns a Mermaid `sequenceDiagram` into an Ordo diagram laid out
exactly; offer them the Mermaid as well if that is easier for them.

## Class diagrams

Read topic `class`. Then:

- `class Order { +id: UUID  +pay() }` is a class node. The members without
  `(` go in the first compartment and the methods in the second.
- `<<interface>>` or `<<abstract>>` goes in the label: `«interface» Payable`.
- `A <|-- B` (B is an A): `from: A, to: B, start: inheritance, end: none`.
- `A <|.. B` (B implements A): the same, with `line: dashed`.
- `A *-- B` (A is made of B): `from: A, to: B, start: composition, end: none`.
- `A o-- B` (A has B): the same with `aggregation`.
- `A --> B`: `end: open-arrow`. `A -- B`: `end: none`.
- `A ..> B` (A uses B): `end: dependency, line: dashed`.
- `A "1" --> "*" B : places`: one label, the role or the multiplicity.

## ER diagrams

Read topic `class`. Each entity is a class node with one compartment, a row
per attribute: `string email UK` becomes `"email UK"`. In
`A ||--o{ B : places`, the symbol on the left is A's end and the one on the
right B's:

- two bars, exactly one: `er-one`
- a bar and a circle, zero or one: `er-zero-one`
- a bar and a crow's foot, one or more: `er-one-many`
- a circle and a crow's foot, zero or more: `er-zero-many`

So `A ||--o{ B : places` is `from: A, to: B` with
`start: er-one, end: er-zero-many, label: places`. A `..` in place of `--`
is `line: dashed`.

## State diagrams

- `[*] --> S` starts at a node with `shape: sm-circ`; `S --> [*]` ends at one
  with `shape: fr-circ`. They show no label, so give each its own id.
- A state is a box with `shape: rounded`. `state Busy { … }` is a group.
- `S --> T : event` is an edge with `label: event`.
- `<<choice>>` is a `diam`; `<<fork>>` and `<<join>>` are a `fork`.
- `note right of S` is a node with `shape: note` beside S.

## Everything else

C4 and architecture diagrams are boxes in groups: people as `person`,
systems and containers as `rect`, databases as `cyl`, and boundaries as
groups. Ordo has nothing for Gantt charts, pies, user journeys, git graphs,
mind maps or other charts: tell the user so, rather than forcing one into
boxes.
