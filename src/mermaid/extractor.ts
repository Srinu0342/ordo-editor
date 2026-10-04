import type { LayoutData } from "mermaid";
import mermaid from "./mermaid.ts";

// Flowchart import, part one: PARSE PLUS HARVEST. A flowchart's positions come
// out of dagre — a solver no rule can reproduce — so the diagram is rendered
// for real and the positioned model is kept on the way through the `ordo`
// layout loader (ordo-layout.ts). The sequence importer is the opposite shape;
// see sequence.ts.

// A subgraph as the flowchart parser records it. Only membership is read.
export type Subgraph = { id: string; nodes?: string[] };

// What the extractor hands toOrdo: dagre's positioned model, plus subgraph
// membership, which the model drops for a collapsed subgraph.
export type MermaidLayout = { mermaid: LayoutData; subgraphs?: Subgraph[] };

// The flowchart parser's db. Mermaid types a Diagram's db as the part every
// diagram type shares; this is the one flowchart method read here.
type FlowDb = { getSubGraphs?: () => Subgraph[] };

export const getMermaidLayoutForOrdo = async (
  src: string,
  graphId: string,
): Promise<MermaidLayout | null> => {
  // Parsed first so a syntax error surfaces as itself, before render can paint
  // Mermaid's error diagram into the page.
  await mermaid.parse(src);

  // The layout module leaves its model on a global. Cleared first: a diagram
  // that never reaches the loader must come back empty, not as whatever was
  // imported last.
  globalThis.__ordo_mermaid = undefined;
  await mermaid.render(graphId, src);

  const layout = globalThis.__ordo_mermaid;
  if (!layout) return null;

  const diagram = await mermaid.mermaidAPI.getDiagramFromText(src);
  const subgraphs = (diagram.db as FlowDb).getSubGraphs?.();

  return { mermaid: layout, subgraphs };
};
