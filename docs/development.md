# Developing Ordo

Running Ordo from source, testing it, and finding your way around the code. For
the ideas behind the code, read [architecture.md](architecture.md) first.

## Run it from source

You need Node.js `^20.19.0` or `>=22.12.0`, the versions Vite supports.

```bash
git clone https://github.com/Srinu0342/ordo-editor.git
cd ordo-editor
npm install
npm run dev                    # http://localhost:5173, with hot reload
```

`npm run dev` starts the server with Vite inside it, so the API, the MCP
endpoint and the editor share one port, and the editor still reloads on save.
Settings come from `.env` at the top of the clone (`cp .env.sample .env`). See
[Running Ordo](../README.md#run-it-for-real) in the README.

## Scripts

| Command             | What it does |
| ------------------- | ------------ |
| `npm run dev`       | Start the server with Vite inside it, with hot reload |
| `npm run build`     | Typecheck, then build a production bundle into `dist/` |
| `npm start`         | Serve the production bundle and the API |
| `npm run preview`   | Serve the production bundle locally |
| `npm test`          | Run the test suite with Node's built-in test runner (through `tsx`) |
| `npm run typecheck` | Run `tsc` without emitting files |

## Tests

Tests sit in `__tests__` folders next to the code they cover, and run on Node's
built-in test runner. The Mermaid tests run the real Mermaid parser under
jsdom, so an importer is tested against what Mermaid itself makes of the
source.

## Project layout

```
server/
├── index.ts             One process: the editor, /api and /mcp
├── api.ts               Local repo API: host and origin checks, routes
├── mcp.ts               MCP tools: validate_ordo, list_shapes
├── workspace.ts         Workspace root and path rules
└── diagrams.ts          .ordo/<name>/ordo.yaml: reads, hash-checked atomic writes
src/
├── App.tsx              Canvas: drag and drop, grouping, clipboard, shortcuts
├── ops.ts               Op-list types and builders
├── theme.ts             Theme tokens
├── shapes/registry.ts   Every Box shape, grouped for the palette
├── nodes/               Box, Group, Class, Text, Tube, Fragment
├── edges/               Edge component, routers, markers, edge attachment
├── render/              React and headless SVG walkers
├── mermaid/             Type detection, flowchart and sequence importers
├── components/          Header, palette, dialogs, repo picker, tab bar
├── ordo/                The Ordo file format: read, validate, write
├── local/               Local repo mode: URL, API client, sync decision
├── history.ts           Undo/redo as diffs (pure)
└── useHistory.ts        Decides where each undo step starts and ends
docs/
├── architecture.md      How it works
├── ordo-rf-mapping.md   The file format, field by field
└── assets/              Logo and README screenshots
examples/
└── checkout.yml         A sample diagram: every node kind, several edge styles
public/
└── favicon.svg          The logo mark, light and dark
```

## Your first change: add a shape

Every box shape is one row in [`src/shapes/registry.ts`](../src/shapes/registry.ts).
Add a row and the palette, its search, the file format and the MCP
`list_shapes` tool all pick it up. [architecture.md](architecture.md#structure-is-a-type-outline-is-a-value)
explains why.

## Before you open a PR

```bash
npm test
npm run typecheck
```

Issues and pull requests are welcome.
