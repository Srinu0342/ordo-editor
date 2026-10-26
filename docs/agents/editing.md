# Editing a diagram that already exists

The user may have arranged the diagram by hand. Your job is to change what it
says and to leave where things sit to them. Everything on the core page still
holds. A sequence diagram is the exception: its layout is yours to rewrite, as
topic `sequence` says.

## Read

Read the file down to the `---` line and stop. What follows is the layout:
positions and sizes the editor writes. A file with no `---` has no layout
yet.

## Change

- Edit the structure in place. Add, change or remove entries in `nodes`,
  `edges` and `data`, and leave everything else as it is, comments and key
  order included. Ordo keeps them too, so the diff stays small.
- Don't rewrite the whole file to make a small change.
- Rename a node or edge by changing its `label`. Never change an id: the
  layout files positions under ids, so a new id is a new node, and it loses
  its place.
- To remove a node, take its id out of `nodes`, its entry out of
  `data.nodes`, and every edge to or from it out of `edges` and `data.edges`.
  `validate_ordo` names any edge you missed.
- To put a new step into an existing edge, a → b, remove that edge and add
  a → new and new → b, with ids of their own.
- To move a node into a group, move its id into the group's list in `nodes`.
  Its saved position is then read inside the group, so tell the user it may
  need moving.
- Never edit below `---`. Lines there for things you removed are dropped on the
  next save; `validate_ordo` reports them as warnings, which is expected.
- Starting the arrangement over is the user's call. If they ask for it, delete
  everything from the `---` down, and Ordo lays the diagram out afresh.

## Where new nodes land

- A node you add next to nodes that already have positions is put in a column
  to the right of them, level with the topmost, one under another. In a group,
  that is often outside the group's frame: a group keeps the size it was saved
  with.
- When every node in a group is new, or the whole file has no layout, Ordo lays
  them out top to bottom along the edges, as for a new diagram.
- A new group is sized to fit its children.
- So after adding nodes, tell the user which ones are new, so they can drag
  them into place. `validate_ordo` says how many nodes have no position yet.

## How the editor picks up your change

- With the diagram open, Ordo checks the file about every ten seconds. If only
  the file changed, it loads your version, and the user can undo it in one
  step.
- If the user also changed the canvas since it last synced, Ordo asks them
  which to keep. It never merges. Make one focused change at a time, and say
  what you changed.
- A file with errors is not loaded: the editor shows the errors and keeps the
  canvas as it was. Run `validate_ordo` before you hand the change over.
