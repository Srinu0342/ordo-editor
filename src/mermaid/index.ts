import { IMPORTABLE, detectDiagram } from "./detect.ts";
import type { Detected } from "./detect.ts";
import { getMermaidLayoutForOrdo } from "./extractor.ts";
import { toOrdo } from "./toOrdo.ts";
import { getSequenceForOrdo } from "./sequence.ts";
import { sequenceToOrdo } from "./sequenceToOrdo.ts";
import type { Measure } from "../measure.ts";
import type { Graph } from "../types.ts";

export * from "./detect.ts";
export * from "./extractor.ts";
export * from "./toOrdo.ts";
export * from "./sequence.ts";
export * from "./sequenceToOrdo.ts";
export * from "./group.ts";

// Mermaid text → Ordo nodes and edges, by way of the ONE importer its type
// calls for. This only routes. The two pipelines are different shapes on
// purpose and stay in their own modules:
//
//   flowchart   parse plus harvest: render through dagre, keep its positions
//               (extractor.ts → toOrdo.ts)
//   sequence    parse only: rebuild the layout from the stream in Ordo's own
//               units (sequence.ts → sequenceToOrdo.ts)
//
// Anything else is refused by name rather than pushed through an importer
// built for something else.
//
// The result carries the diagram's `title` — front-matter, or a sequence
// diagram's own `title` line — for naming the group it lands in (group.ts).
export type MermaidImport = Detected & Graph & { warnings: string[] };

export async function importMermaid(
  text: string,
  { measureText }: { measureText?: Measure } = {},
): Promise<MermaidImport> {
  const found = detectDiagram(text);
  const warnings: string[] = [];

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
