import mermaid from "./mermaid.ts";

// What a piece of Mermaid text IS, decided before anything is drawn.
//
// The type picks the whole pipeline — a flowchart is harvested from Mermaid's
// own dagre run, a sequence diagram is rebuilt from its parse alone — so it is
// read with Mermaid's own detector, the one `render` uses, rather than by
// sniffing the first line: front-matter, `%%{init}%%` directives and comments
// can all come before the keyword, and the detector already knows to skip them.

// detectType's answer → the importer for it. `graph` and `flowchart` both come
// back as flowchart-v2; the other two are the older and the ELK spellings.
export type Family = "flowchart" | "sequence";

const FAMILY: Record<string, Family> = {
  flowchart: "flowchart",
  "flowchart-v2": "flowchart",
  "flowchart-elk": "flowchart",
  sequence: "sequence",
};

// What can be imported, said the same way wherever a type is turned away. It
// sits beside FAMILY so that the two change together.
export const IMPORTABLE = "Ordo imports flowcharts and sequence diagrams so far.";

// For saying what was found, including the kinds with no importer yet.
const NAMES: Record<string, string> = {
  flowchart: "Flowchart",
  sequence: "Sequence diagram",
  class: "Class diagram",
  classDiagram: "Class diagram",
  state: "State diagram",
  stateDiagram: "State diagram",
  er: "ER diagram",
  gantt: "Gantt chart",
  pie: "Pie chart",
  journey: "User journey",
  mindmap: "Mindmap",
  timeline: "Timeline",
  gitGraph: "Git graph",
  c4: "C4 diagram",
  requirement: "Requirement diagram",
  quadrantChart: "Quadrant chart",
  xychart: "XY chart",
  sankey: "Sankey diagram",
  packet: "Packet diagram",
  block: "Block diagram",
  architecture: "Architecture diagram",
  kanban: "Kanban board",
  radar: "Radar chart",
  treemap: "Treemap",
};

// A Markdown file carries its diagram in a fenced block. The first ```mermaid
// (or ~~~mermaid) fence is the diagram; without one, the text is the diagram.
const FENCE =
  /^[ \t]*(`{3,}|~{3,})[ \t]*mermaid\b[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm;

export function mermaidSource(text: string) {
  const raw = String(text ?? "");
  FENCE.lastIndex = 0;
  const blocks = [...raw.matchAll(FENCE)];
  return blocks.length
    ? { source: blocks[0][2], blocks: blocks.length }
    : { source: raw, blocks: 0 };
}

// Front-matter — a `---` block ahead of the keyword — can name a diagram. Mermaid
// only applies it during a full render, so a parse alone loses it; it is read
// here instead, for the name of the group the import arrives in.
const FRONT = /^\s*---[ \t]*\n([\s\S]*?)\n[ \t]*---[ \t]*(?:\n|$)/;
const TITLE = /^[ \t]*title[ \t]*:[ \t]*(.*?)[ \t]*$/m;

export function frontMatterTitle(source: string) {
  const block = FRONT.exec(String(source ?? ""))?.[1];
  const raw = block ? TITLE.exec(block)?.[1] : null;
  return raw ? raw.replace(/^(["'])(.*)\1$/, "$2").trim() || null : null;
}

/**
 * { family, type, name, source, label, blocks, title }
 *
 * `family` is the importer to use — "flowchart", "sequence", or null when
 * there is none. `type` is Mermaid's own name for what it found (null when it
 * found nothing it knows), and `name` is what to call it in a sentence ("Class
 * diagram"). `source` is the diagram text itself, out of its Markdown fence if
 * it had one; `blocks` counts the fences. `title` is the front-matter title,
 * when there is one.
 */
export type Detected = {
  family: Family | null;
  type: string | null;
  name: string | null;
  source: string;
  blocks: number;
  title: string | null;
  label: string;
};

export function detectDiagram(text: string): Detected {
  const { source, blocks } = mermaidSource(text);
  const title = frontMatterTitle(source);
  if (!source.trim())
    return { family: null, type: null, name: null, source, blocks, title, label: "Nothing to import" };

  let type: string | null = null;
  try {
    type = mermaid.detectType(source);
  } catch {
    // UnknownDiagramError: nothing Mermaid recognises
  }

  const family = type ? (FAMILY[type] ?? null) : null;
  const name = type && (NAMES[family ?? type] ?? type);
  const label = !name
    ? "Not a Mermaid diagram"
    : family
      ? name
      : `${name} — no importer yet`;

  return { family, type, name, source, blocks, title, label };
}
