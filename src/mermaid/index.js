import { IMPORTABLE, detectDiagram } from "./detect.js";
import { getMermaidLayoutForOrdo } from "./extractor.js";
import { toOrdo } from "./toOrdo.js";
import { getSequenceForOrdo } from "./sequence.js";
import { sequenceToOrdo } from "./sequenceToOrdo.js";

export * from "./detect.js";
export * from "./extractor.js";
export * from "./toOrdo.js";
export * from "./sequence.js";
export * from "./sequenceToOrdo.js";
export * from "./group.js";

// Mermaid text → Ordo nodes and edges, by way of the ONE importer its type
// calls for. This only routes. The two pipelines are different shapes on
// purpose and stay in their own modules:
//
//   flowchart   parse plus harvest: render through dagre, keep its positions
//               (extractor.js → toOrdo.js)
//   sequence    parse only: rebuild the layout from the stream in Ordo's own
//               units (sequence.js → sequenceToOrdo.js)
//
// Anything else is refused by name rather than pushed through an importer
// built for something else.
//
// The result carries the diagram's `title` — front-matter, or a sequence
// diagram's own `title` line — for naming the group it lands in (group.js).
export async function importMermaid(text, { measureText } = {}) {
  const found = detectDiagram(text);
  const warnings = [];

  if (found.blocks > 1)
    warnings.push(`The file holds ${found.blocks} Mermaid diagrams; imported the first.`);

  switch (found.family) {
    case "flowchart": {
      const graphId = `mermaid-${Math.random().toString(36).slice(2)}`;
      const layout = await getMermaidLayoutForOrdo(found.source, graphId);
      if (!layout)
        throw new Error("Mermaid did not hand back a layout for this flowchart.");
      const { nodes, edges, unsupported } = toOrdo(layout);
      if (unsupported.length)
        warnings.push(`Drawn as rectangles, no Ordo shape for: ${unsupported.join(", ")}.`);
      return { ...found, nodes, edges, warnings };
    }

    case "sequence": {
      const model = await getSequenceForOrdo(found.source);
      const { nodes, edges, warnings: more } = sequenceToOrdo(model, { measureText });
      return {
        ...found,
        title: found.title ?? model.title,
        nodes,
        edges,
        warnings: [...warnings, ...model.warnings, ...more],
      };
    }

    default:
      throw new Error(
        found.type ? `${found.label}. ${IMPORTABLE}` : `${found.label}.`,
      );
  }
}
