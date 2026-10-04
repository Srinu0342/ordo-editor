import mermaid from "./mermaid.js";

// Flowchart import, part one: PARSE PLUS HARVEST. A flowchart's positions come
// out of dagre — a solver no rule can reproduce — so the diagram is rendered
// for real and the positioned model is kept on the way through the `ordo`
// layout loader (ordo-layout.js). The sequence importer is the opposite shape;
// see sequence.js.

export const getMermaidLayoutForOrdo = async (src, graphId) => {
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
  const subgraphs = diagram.db.getSubGraphs?.();

  return { mermaid: layout, subgraphs };
};
