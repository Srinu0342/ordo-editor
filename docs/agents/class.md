# Class and ER diagrams

A UML class diagram or an ER diagram is class nodes joined by edges whose
markers say how they relate. Everything on the core page still holds.

## Class nodes

```yaml
ordo: 1
nodes:
  - order
data:
  nodes:
    order:
      kind: class
      label: Order
      sections:
        - ["+id: UUID", "+total: Money", "-status: Status"]
        - ["+pay()", "+refund(Money)"]
```

- `label` is the class name, drawn bold in a band at the top.
- `sections` lists the compartments under the name, top to bottom, and each
  compartment lists its rows. In UML that is the attributes, then the
  operations. An ER entity has one compartment of columns. A compartment may
  be empty: `[]`.
- Quote every row. Most hold `: `, and a row starting with `#` would be read as
  a YAML comment.
- The box is 190 px wide and grows to fit its rows. A row longer than about 24
  characters is cut off, so shorten types and leave out parameter names.
- `textSize` and `textWeight` restyle the name. The rows are a pixel smaller,
  and regular.
- Mark an interface or an abstract class in its label:
  `label: «interface» Payable`, `label: «abstract» Item`.

## UML relationships

Place parents above children and wholes above their parts, and write each
relationship from the parent or the whole, with its marker at the `start`. A
marker is drawn at the end it is set on, pointing into that node: the triangle
at the parent, the diamond at the whole. Topic `layout` has the spacing.

| Relationship | Edge | `data.edges.<id>` |
|---|---|---|
| Inheritance: a Card is a PaymentMethod | `from: method, to: card` | `start: inheritance, end: none` |
| Realization: Card implements Payable | `from: payable, to: card` | `start: inheritance, end: none, line: dashed` |
| Composition: an Order is made of LineItems | `from: order, to: item` | `start: composition, end: none` |
| Aggregation: a Team has Players | `from: team, to: player` | `start: aggregation, end: none` |
| Association: an Order knows its Customer | `from: order, to: customer` | `end: open-arrow`, or `end: none` when it runs both ways |
| Dependency: Checkout uses a Gateway | `from: checkout, to: gateway` | `end: dependency, line: dashed` |

An edge has one label. Use it for a role or a multiplicity: `label: places`,
or `label: 1..*`.

## ER relationships

An entity is a class node with one compartment of columns. Mark keys in the
row: `"id PK"`, `"customer_id FK"`. A relationship is an edge with a crow's
foot marker at each end:

- `er-one`: exactly one
- `er-zero-one`: zero or one
- `er-one-many`: one or more
- `er-zero-many`: zero or more
- `er-many`: many

Write it from the "one" side, and place the parent entity above: "a customer
places zero or more orders" is `from: customer, to: order` with
`start: er-one, end: er-zero-many, label: places`. If the diagram tells
identifying relationships from the rest, draw the non-identifying ones
`line: dashed`.

## Example: classes

```yaml
ordo: 1
nodes:
  - payable
  - card
  - wallet
  - order
  - item
edges:
  - { id: is-card, from: payable, to: card }
  - { id: is-wallet, from: payable, to: wallet }
  - { id: lines, from: order, to: item }
  - { id: pays, from: order, to: payable }
data:
  nodes:
    payable:
      kind: class
      label: «interface» Payable
      sections:
        - []
        - ["+charge(Money): Receipt"]
    card:
      kind: class
      label: Card
      sections:
        - ["-number: string", "-expiry: Date"]
        - ["+charge(Money): Receipt"]
    wallet:
      kind: class
      label: Wallet
      sections:
        - ["-balance: Money"]
        - ["+charge(Money): Receipt"]
    order:
      kind: class
      label: Order
      sections:
        - ["+id: UUID", "+total: Money"]
        - ["+pay(): Receipt"]
    item:
      kind: class
      label: LineItem
      sections:
        - ["+sku: string", "+qty: int"]
  edges:
    is-card: { start: inheritance, end: none, line: dashed }
    is-wallet: { start: inheritance, end: none, line: dashed }
    lines: { start: composition, end: none, label: 1..* }
    pays: { end: dependency, line: dashed, label: uses }
---
ordo-layout: 1
nodes:
  order: { x: 0, y: 0 }
  payable: { x: 390, y: 11 }
  item: { x: 0, y: 200 }
  card: { x: 260, y: 200 }
  wallet: { x: 520, y: 200 }
```

## Example: entities

```yaml
ordo: 1
nodes:
  - customer
  - order
  - product
  - line
edges:
  - { id: places, from: customer, to: order }
  - { id: holds, from: order, to: line }
  - { id: sold-as, from: product, to: line }
data:
  nodes:
    customer: { kind: class, label: CUSTOMER, sections: [["id PK", "email", "name"]] }
    order: { kind: class, label: ORDER, sections: [["id PK", "customer_id FK", "placed_at"]] }
    product: { kind: class, label: PRODUCT, sections: [["id PK", "sku", "price"]] }
    line: { kind: class, label: LINE_ITEM, sections: [["order_id FK", "product_id FK", "qty"]] }
  edges:
    places: { label: places, start: er-one, end: er-zero-many }
    holds: { label: holds, start: er-one, end: er-one-many }
    sold-as: { label: sold as, start: er-one, end: er-zero-many }
---
ordo-layout: 1
nodes:
  customer: { x: 0, y: 0 }
  order: { x: 0, y: 184 }
  product: { x: 260, y: 184 }
  line: { x: 130, y: 368 }
```
