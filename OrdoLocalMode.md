# Ordo Local Mode — Iteration 1 (pointer)

Full spec (Claude Doc, 2026-10-09): https://claude.ai/code/artifact/5b219173-4525-48a1-862f-c78d3cf8708a
Implementation plan (2026-10-09): `OrdoInteraction.md` at the root of the ordo-editor repo — 10 phases with files, signatures, tests, commit plan, risks and acceptance, grounded in spikes against a clean install (baseline: 186/186 tests, typecheck clean).

## Decided by Subhadip (2026-10-09)
- D1 Two modes: free-form (draw, open and download YAML) and local repo mode.
- D2 No SVG import or export in iteration 1.
- D3 Each diagram lives at `<repo>/.ordo/<name>/ordo.yaml`; folder name = tab name; Ordo creates `.ordo/` if missing.
- D4 Diagrams are footer tabs (Lucid-style); `+` creates a new diagram.
- D5 Tab actions in iteration 1: create only.
- D6 No automatic sync; a Sync button, two-way, Ordo picks the direction.
- D7 Repo picker; picked repo shows in the URL with a parameter marking local mode.
- D8 One Ordo instance serves every repo (instance-per-repo rejected as bad UX).
- D9 Runs from a clone (npm) or Docker, local only; hosted/GitHub later.

## Proposed in the spec, awaiting confirmation
P1 `source=local` URL param · P2 `repo` relative to workspace root · P3 root = home (npm) or /workspace (Docker), `ORDO_WORKSPACE` overrides · P4 server keeps no current repo · P5 query params, no router · P6 I/O only inside `<repo>/.ordo/`, picker returns names only · P7 hash-checked writes (If-Match) · P8 tabs A–Z, no order file · P9 ASCII names, case-insensitive unique · P10 `.ordo/` created with first diagram · P11 one live canvas, guard on leaving unsynced tab · P12 server validates YAML before write · P13 `.yaml` everywhere · P14 Ordo never runs git · P15 loopback-only binding · P16 Mermaid import keeps the file baseline in local mode.

## Findings from the plan's spikes (2026-10-09)
- Empty diagram text: `ordo: 1\nnodes: []\n---\nordo-layout: 1\n`.
- Writer normalises whitespace: 4-space files lose indentation on first write (42/58 lines) unless the writer passes `indent`/`indentSeq` to `yaml`; CRLF → LF; structure-only files gain a layout doc. Plan: compare canvas with its own post-load export so opening never marks a diagram unsynced.
- Express 5 decodes `%2F` in path params; `tab` must be matched against `.ordo/` entries, never joined.
- `useNodesInitialized()` stays `true` for one commit after a canvas swap; undo must be cleared on tab switch; git removes a diagram's folder with its last file.

## Context
- Codebase review (2026-10-09): `ordo-workstreams.md` is stale; WS1/WS2 are implemented in `src/ordo/` with minimal-diff write-back.
- Archify (tt-a1i/archify) compared: skill + zero-dep CLI, read-only HTML viewer, `preview` = GET-only loopback server with SSE. Ordo differs by being a bidirectional editor.