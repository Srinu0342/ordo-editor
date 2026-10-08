// Phase 5 of the .ordo build: Mermaid → canvas → Ordo → canvas.
//
// Mermaid's only job is to put React Flow nodes and edges on the canvas; the
// YAML is always written from those. So every diagram the importers can bring
// in — flowcharts and sequence diagrams alike — must export with no
// diagnostics, import back to the same canvas apart from React Flow's own
// runtime fields, and export again byte-identically.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shimTextGeometry } from "./dom.ts";
import { ENROLMENT, ENROLMENT_SHORTHAND, EXTENDED, LOUNGE } from "./fixtures.ts";
import type { Edge, Node } from "@xyflow/react";

shimTextGeometry();
const { importMermaid, groupDiagram, groupId, diagramName } = await import("../index.ts");
const { exportOrdo, importOrdo, emptySession } = await import("../../ordo/index.ts");
const { canvasNode, RUNTIME_EDGE_KEYS, RUNTIME_NODE_KEYS } = await import("../../ordo/rf-mapping.ts");

// Every Mermaid input the repo's tests use, and a probe for every feature the
// flowchart importer handles: arrowheads, dotted and thick links, invisible
// links, subgraphs (nested, empty, collapsed), curves, odd and non-ASCII ids,
// text nodes, icons, self-loops, styles it drops, front matter.
const SOURCES: [name: string, source: string][] = [
  ["flowchart TD (detect.test)", "flowchart TD\n  A-->B"],
  ["graph LR (detect.test)", "graph LR\n  A-->B"],
  ["flowchart-elk (detect.test)", "flowchart-elk TD\n  A-->B"],
  ["front-matter title (group.test)", "---\ntitle: Pay flow\n---\nflowchart TD\nA-->B"],
  ["arrowheads", "flowchart LR\n  a1 --> b1\n  a2 --- b2\n  a8 --o b8\n  a9 --x b9\n  a10 <--> b10\n  a11 o--o b11\n  a12 x--x b12"],
  ["dotted links", "flowchart LR\n  a3 -.-> b3\n  a4 -.- b4\n  a13 <-.-> b13\n  a17 -. dotted text .-> b17\n  a20 -..-> b20"],
  ["thick links", "flowchart LR\n  a5 ==> b5\n  a6 === b6\n  a14 <==> b14\n  a18 == thick text ==> b18\n  a21 ====> b21\n  a22 o==o b22"],
  ["invisible link", "flowchart LR\n  a7 ~~~ b7\n  a7 --> c7"],
  ["labels and chains", "flowchart LR\n  a15 -- text --> b15\n  a16 -->|pipe label| b16\n  a19 ----> b19\n  A & B --> C --> D & E"],
  ["directions", "flowchart BT\n  A --> B\n  B --> C\n  C --> A"],
  ["nested subgraphs", "flowchart TB\n  c1-->a2\n  subgraph one\n    a1-->a2\n  end\n  subgraph two [Two Title]\n    direction LR\n    b1-->b2\n    subgraph inner\n      i1-->i2\n    end\n  end\n  subgraph three\n    c1-->c2\n  end\n  one --> two\n  three --> two\n  two --> c2"],
  ["subgraph titles", "flowchart LR\n  subgraph Some Title With Spaces\n    q1 --> q2\n  end\n  subgraph \"Quoted title\"\n    q3\n  end"],
  ["empty subgraph", "flowchart LR\n  subgraph E [Empty group]\n  end\n  A --> B"],
  ["collapsed subgraph", "flowchart LR\n  subgraph S1 [Collapsed]\n    x1 --> x2\n    subgraph S1a\n      y1\n    end\n  end\n  S1@{ view: collapsed }\n  start --> x1\n  x2 --> stop"],
  ["edge into a collapsed subgraph", "flowchart LR\n  subgraph G\n    m1 --> m2\n  end\n  G@{ view: collapsed }\n  out1 --> m1\n  m2 --> out2\n  out1 --> G"],
  ["styles, classes, click", "flowchart LR\n  A:::hot --> B\n  classDef hot fill:#f96,stroke:#333,stroke-width:4px\n  style B fill:#bbf,stroke:#f66\n  linkStyle 0 stroke:#ff3,stroke-width:4px\n  click A \"https://example.com\" \"Tooltip A\"\n  C --> D"],
  ["curves", "flowchart LR\n  A --> B\n  B --> C\n  linkStyle default interpolate stepBefore\n  linkStyle 1 interpolate monotoneX"],
  ["curve config", "---\ntitle: Probe Title\nconfig:\n  flowchart:\n    curve: stepAfter\n---\nflowchart LR\n  A --> B"],
  ["per-edge curves", "flowchart LR\n  s0 c0@--> t0\n  c0@{ curve: linear }\n  s1 c1@--> t1\n  c1@{ curve: step }\n  s2 c2@--> t2\n  c2@{ curve: natural }"],
  ["edge ids and animation", "flowchart LR\n  A e1@--> B\n  B e2@==> C\n  e1@{ animate: true }"],
  ["markdown and unicode labels", "flowchart LR\n  A[\"`**Bold** _it_`\"] --> B[\"Line1<br/>Line2\"]\n  B --> C[\"Quote #quot;x#quot; #amp;\"]\n  C --> D[ünïcödé 名前]\n  D -->|\"`**md** edge`\"| E"],
  ["odd ids", "flowchart LR\n  node_1 --> node-2\n  node-2 --> 3d\n  3d --> 42"],
  ["non-ASCII ids", "flowchart LR\n  ä --> ö"],
  ["self-loops", "flowchart TD\n  A --> A\n  A --> B\n  B -->|loop label| B"],
  ["icons", "flowchart TD\n  I1@{ icon: \"fa:user\", form: \"circle\", label: \"User\" }\n  I2@{ icon: \"fa:car\", form: \"square\", label: \"Car\" }\n  I1 --> I2"],
  ["text node", "flowchart LR\n  T@{ shape: text, label: \"free text\" } --> R@{ shape: rect, label: \"R\" }"],
  ["extended shapes", "flowchart LR\n  a@{ shape: cyl } --> b@{ shape: diam } --> c@{ shape: hex } --> d@{ shape: doc } --> e@{ shape: stadium }"],
  ["sequence: ENROLMENT", ENROLMENT],
  ["sequence: ENROLMENT_SHORTHAND", ENROLMENT_SHORTHAND],
  ["sequence: LOUNGE", LOUNGE],
  ["sequence: EXTENDED", EXTENDED],
  ["sequence: inline", "sequenceDiagram\n  A->>B: hi"],
];

/** What App.onMermaidText puts on the canvas for `source`, beside whatever is already there. */
async function onCanvas(source: string, present: Node[] = []) {
  const result = await importMermaid(source);
  const id = groupId(present);
  const { nodes, edges } = groupDiagram(result, {
    id,
    label: diagramName(result.title, present),
    at: { x: 0, y: 0 },
    data: { mermaid: result.type },
  });
  // The import arrives selected, as it does on the canvas.
  return { nodes: nodes.map((n) => (n.id === id ? { ...n, selected: true } : n)) as Node[], edges: edges as Edge[] };
}

const strip = (o: Record<string, unknown>, runtime: ReadonlySet<string>) =>
  Object.fromEntries(Object.entries(o).filter(([k, v]) => !runtime.has(k) && v !== undefined));

/** The canvas as export sees it: React Flow's runtime fields left out, sizes and positions as written. */
function canon(nodes: Node[], edges: Edge[]) {
  return {
    nodes: Object.fromEntries(nodes.map((n) => [n.id, strip(canvasNode(n), RUNTIME_NODE_KEYS)])),
    edges: Object.fromEntries(edges.map((e) => [e.id, strip(e as unknown as Record<string, unknown>, RUNTIME_EDGE_KEYS)])),
  };
}

function roundTrip(nodes: Node[], edges: Edge[]) {
  const out = exportOrdo(nodes, edges, emptySession());
  assert.deepEqual(out.diagnostics, [], out.diagnostics.map((d) => d.message).join("\n"));
  const back = importOrdo(out.ordo!.text, out.layout!.text);
  assert.deepEqual(back.diagnostics, []);
  assert.deepEqual(canon(back.nodes, back.edges), canon(nodes, edges));
  // …and the canvas it comes back as writes the same bytes.
  const again = exportOrdo(back.nodes, back.edges, { name: "diagram", ordo: back.ordo, layout: back.layout });
  assert.equal(again.ordo?.text, out.ordo!.text);
  assert.equal(again.layout?.text, out.layout!.text);
  return out;
}

for (const [name, source] of SOURCES) {
  test(`Mermaid → canvas → Ordo → canvas: ${name}`, async () => {
    const { nodes, edges } = await onCanvas(source);
    roundTrip(nodes, edges);
  });
}

test("several imports side by side on one canvas", async () => {
  const first = await onCanvas(SOURCES[0][1]);
  const second = await onCanvas(LOUNGE, first.nodes);
  const third = await onCanvas(SOURCES[10][1], [...first.nodes, ...second.nodes]);
  roundTrip(
    [...first.nodes, ...second.nodes, ...third.nodes],
    [...first.edges, ...second.edges, ...third.edges],
  );
});

test("a sequence diagram's tubes keep the edge they ride and where they sit on it", async () => {
  const { nodes, edges } = await onCanvas(LOUNGE);
  const out = roundTrip(nodes, edges);
  const rider = nodes.find((n) => n.type === "tube" && n.data.attach)!;
  assert.match(out.ordo!.text, /kind: tube/);
  const { edgeId } = rider.data.attach as { edgeId: string };
  assert.match(out.ordo!.text, new RegExp(`attach: ${edgeId.replace(/[/:]/g, ".")}`));
  assert.match(out.layout!.text, /t: /);
});
