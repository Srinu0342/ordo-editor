# Editing a diagram that already exists

The user may have arranged the diagram by hand. Change what it says, keep
where things already sit, and place what you add yourself. Everything on the
core page and topic `layout` still holds. A sequence diagram is laid out on
its grid: renumber the rows and rewrite its layout, as topic `sequence` says.

## Read

Read the whole file. Below the `---` line is where everything sits, which you
need to place a new node beside the ones it connects to. A file with no `---`
has no layout yet: every node in it is placed by Ordo when it opens. Call
`render_ordo` before you change anything, to see what the user sees.

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
- To move a node into a group, move its id into the group's list in `nodes`,
  and give it a new position: inside a group, x and y count from the group's
  corner.
- Below `---`, change only what your edit needs: positions for what you add or
  move, and sides for new edges. Leave the rest as it is. Lines there for
  things you removed are dropped on the next save; `validate_ordo` reports
  them as warnings, which is expected.
- Starting the arrangement over is the user's call. If they ask for it, write
  a new layout for the whole diagram, as topic `layout` says.

## Placing new nodes

- Put each new node next to what it connects to, lined up with its neighbours
  as topic `layout` says. If there is no room, move as few nodes as you can to
  make some, and tell the user which ones you moved.
- A group with a saved `w` and `h` keeps that size, so a node you put past its
  frame is drawn outside it. Make the group bigger, or take its `w` and `h` out
  so it fits its children.
- A node you leave without a position is put in a column to the right of its
  placed neighbours, level with the topmost, one under another: often outside
  its group's frame. `validate_ordo` says how many nodes have no position.
- Call `render_ordo` after the change, and check the new nodes sit where the
  diagram reads well.

## How the editor picks up your change

- With the diagram open, Ordo checks the file about every ten seconds. If only
  the file changed, it loads your version, and the user can undo it in one
  step.
- If the user also changed the canvas since it last synced, Ordo asks them
  which to keep. It never merges. Make one focused change at a time, and say
  what you changed.
- A file with errors is not loaded: the editor shows the errors and keeps the
  canvas as it was. Run `validate_ordo` before you hand the change over.
