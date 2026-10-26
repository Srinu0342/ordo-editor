import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import type { ErrorRequestHandler } from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { localhostHostValidation, localhostOriginValidation } from "@modelcontextprotocol/express";
import { GUIDE_TOPICS, readDiagram } from "../src/ordo/index.ts";
import { resolve } from "../src/ordo/read.ts";
import type { Diagnostic } from "../src/ordo/index.ts";
import { DIAGRAM_FILE, ORDO_DIR, readDiagramFile } from "./diagrams.ts";
import { guidePage } from "./guide.ts";
import { renderDiagram } from "./render/png.ts";
import { HttpError, insideRoot, parseRel, resolveInRoot } from "./workspace.ts";
import type { Workspace } from "./workspace.ts";

// MCP over Streamable HTTP, at /mcp on the same port as the editor.
//
// Three tools, all read-only. The model learns the format from ordo_guide,
// writes the file itself, layout included, checks it with validate_ordo, and
// looks at it with render_ordo. Nothing here builds a diagram piece by piece:
// the file is the interface, and agents that use Ordo can already write files.
//
// Stateless: every POST gets a fresh server and transport, and nothing is kept
// between calls. That suits the dev server, which `tsx watch` restarts on every
// edit; with sessions, each restart would cut the client off.
//
// The tools only reach what runs in Node. The diagram being drawn lives in the
// browser tab, so nothing here can see or change the canvas: render_ordo draws
// the file as the editor would open it, not what is on screen, and the
// editor's Sync picks up a file the agent writes.

// Sent once, when a client connects; most put it in front of the model.
const INSTRUCTIONS =
  "Ordo draws diagrams from YAML files kept in the repo, at .ordo/<name>/ordo.yaml. Before you write or edit one, call ordo_guide to learn the format, and its layout topic to place things yourself. After every change, call validate_ordo with the file's path and fix what it reports, then call render_ordo to see the diagram and fix what looks wrong.";

// "core" is accepted as well as no topic: an agent told about "the core page" may ask for it by name.
const GUIDE_INPUT = z.object({
  topic: z
    .enum(["core", ...GUIDE_TOPICS])
    .optional()
    .describe("A topic page: layout, flowchart, sequence, class, editing or mermaid. Leave it out for the core page, which every diagram needs."),
});

const DIAGRAM_INPUT = z.object({
  path: z
    .string()
    .optional()
    .describe("The diagram's file, <repo>/.ordo/<name>/ordo.yaml: an absolute path, or one relative to the workspace root."),
  text: z.string().optional().describe("The file's whole text, for a diagram that is not in a file yet."),
});

/** A tool result that says the call itself went wrong, rather than the diagram. */
const failed = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

/**
 * The diagram a tool was given, by path or by text, and what to call it in
 * the answer; or the failed result that says why there is none.
 */
async function diagramOf(
  ws: Workspace,
  { path: given, text }: { path?: string; text?: string },
): Promise<{ text: string; name: string } | ReturnType<typeof failed>> {
  if (given === undefined && text === undefined) return failed("Pass path, the diagram's ordo.yaml, or text, the file's contents.");
  if (given !== undefined && text !== undefined) return failed("Pass path or text, not both.");
  if (text !== undefined) return { text, name: "The diagram" };
  try {
    return { text: await readDiagramAt(ws, given!), name: given! };
  } catch (e) {
    if (e instanceof HttpError) return failed(e.message);
    throw e;
  }
}

/**
 * The diagram file a tool was pointed at: `<repo>/.ordo/<name>/ordo.yaml`,
 * absolute or relative to the workspace root. The repo goes through the
 * checks every /api call's repo does (resolveInRoot), and the file is read by
 * readDiagramFile, which refuses a symlink anywhere inside .ordo. Only diagram
 * files can be read this way. Throws HttpError with a sentence to show.
 */
async function readDiagramAt(ws: Workspace, given: string): Promise<string> {
  const segments = given.split("/");
  const n = segments.length;
  if (n < 3 || segments[n - 1] !== DIAGRAM_FILE || segments[n - 3] !== ORDO_DIR)
    throw new HttpError(400, `${given} is not a diagram file; give the path of one, <repo>/${ORDO_DIR}/<name>/${DIAGRAM_FILE}.`);
  const tab = segments[n - 2];
  const repo = segments.slice(0, n - 3).join("/");

  let rel = repo;
  if (path.isAbsolute(given)) {
    // Real-pathed first, so a link into the workspace (/tmp → /private/tmp)
    // counts where it lands; resolveInRoot checks the result again.
    const real = await fs.realpath(repo || "/").catch(() => null);
    if (!real) throw new HttpError(404, `There is no folder ${repo}.`);
    if (!insideRoot(ws, real))
      throw new HttpError(403, `${given} is outside the Ordo workspace (${ws.label}); pass the file's text instead.`);
    rel = path.relative(ws.root, real).split(path.sep).join("/");
  }
  const repoDir = await resolveInRoot(ws, parseRel(rel, "path"));
  return (await readDiagramFile(repoDir, tab)).text;
}

/** "1:5", the place a diagnostic points at, or "-" when it has none. */
const where = (d: Diagnostic) => (d.line === undefined ? "-" : d.col === undefined ? `${d.line}` : `${d.line}:${d.col}`);

const see = (d: Diagnostic) =>
  d.guide === undefined ? "" : d.guide === "core" ? " (see ordo_guide)" : ` (see ordo_guide topic "${d.guide}")`;

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * What validate_ordo answers: compact text for a model to act on. Every
 * diagnostic is one line, `line:col severity: message`. A diagram with no
 * errors also says what it holds, so the agent can check it wrote what it
 * meant to, and whether it left nodes for Ordo to place.
 */
function validationReport(text: string, name: string): string {
  const read = readDiagram(text);
  const errors = read.diagnostics.filter((d) => d.severity === "error");
  const warnings = read.diagnostics.filter((d) => d.severity === "warning");
  const lines = read.diagnostics.map((d) => `${where(d)} ${d.severity}: ${d.message}${see(d)}`);

  if (!read.ok || !read.ordo?.value) {
    const tally = [count(errors.length, "error"), ...(warnings.length ? [count(warnings.length, "warning")] : [])].join(", ");
    const after = warnings.length ? " A warning doesn't stop the diagram opening, but read each one." : "";
    return [`${name} has ${tally}.`, ...lines, "", `Fix every error and check again.${after}`].join("\n");
  }

  const diagram = resolve(read.ordo.value);
  const groups = diagram.nodes.filter((n) => n.isGroup).length;
  const placed = new Set(Object.keys(read.layout?.value?.nodes ?? {}));
  const unplaced = diagram.nodes.filter((n) => !placed.has(n.id)).length;
  const layout =
    read.layout === null
      ? 'no layout: Ordo will place every node top to bottom when the diagram opens; to choose where things go, write the layout (see ordo_guide topic "layout")'
      : unplaced === 0
        ? "every node has a position"
        : `${count(unplaced, "node")} without a position: Ordo will place ${unplaced === 1 ? "it" : "them"} when the diagram opens; give ${unplaced === 1 ? "it a position" : "them positions"} yourself (see ordo_guide topic "layout")`;
  const holds = `${count(diagram.nodes.length, "node")}${groups ? ` (${count(groups, "group")})` : ""}, ${count(diagram.edges.length, "edge")}`;
  const head = `${name} is valid: ${holds}; ${layout}.`;
  return warnings.length ? [head, `${count(warnings.length, "warning")}; the diagram opens, but read each one:`, ...lines].join("\n") : head;
}

function ordoServer(ws: Workspace) {
  const server = new McpServer({ name: "ordo", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "ordo_guide",
    {
      title: "How to write an Ordo diagram",
      description:
        "Call this before you write or edit an Ordo diagram (.ordo/<name>/ordo.yaml). With no topic it returns the core page: what the file holds, every node kind, edge field and shape, an example, and the rules. Then ask for a topic: layout (where to put everything; read it for every diagram), flowchart (flowcharts and process diagrams: decisions, loops, parallel paths, swimlanes), sequence (sequence diagrams), class (UML class and ER diagrams), editing (changing a diagram that already exists) or mermaid (turning Mermaid into Ordo).",
      inputSchema: GUIDE_INPUT,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ topic }) => ({ content: [{ type: "text", text: await guidePage(topic) }] }),
  );

  server.registerTool(
    "validate_ordo",
    {
      title: "Check an Ordo diagram",
      description:
        "Check an Ordo diagram the way the editor reads it, and get every problem in one pass: line and column, what is wrong, the values allowed, the nearest match for a misspelling, and the ordo_guide topic that explains it. Pass path, the diagram's ordo.yaml in the workspace, or text, the file's contents. Call it after every change, before you tell the user the diagram is done.",
      inputSchema: DIAGRAM_INPUT,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      const diagram = await diagramOf(ws, args);
      if ("isError" in diagram) return diagram;
      return { content: [{ type: "text", text: validationReport(diagram.text, diagram.name) }] };
    },
  );

  server.registerTool(
    "render_ordo",
    {
      title: "See an Ordo diagram",
      description:
        "Draw an Ordo diagram as a PNG, the way the editor shows it when the file opens, so you can see the layout you wrote: what overlaps, where the lines run, which labels collide, what text is cut off. The picture is the diagram's own px doubled, or smaller so its long side fits 1568 px, with 24 px of margin round the drawing. Pass path, the diagram's ordo.yaml in the workspace, or text, the file's contents. Call it once validate_ordo reports no errors, and again after each change to the layout, until the diagram reads well.",
      inputSchema: DIAGRAM_INPUT,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      const diagram = await diagramOf(ws, args);
      if ("isError" in diagram) return diagram;
      let drawn;
      try {
        drawn = await renderDiagram(diagram.text);
      } catch (e) {
        return failed(`Ordo couldn't draw ${diagram.name}: ${(e as Error).message}.`);
      }
      if (!drawn.ok)
        return failed(`${diagram.name} has ${count(drawn.diagnostics.length, "error")}, so it can't be drawn. Call validate_ordo, fix them, and draw it again.`);
      return { content: [{ type: "image", data: drawn.png.toString("base64"), mimeType: "image/png" }] };
    },
  );

  return server;
}

export function createMcp(ws: Workspace): express.Router {
  const mcp = express.Router();

  // No auth, so only local clients: a web page open in the browser could
  // otherwise reach this through DNS rebinding or a cross-site POST.
  mcp.use(localhostHostValidation(), localhostOriginValidation());
  // As much as a diagram may hold (a PUT to /api takes 5 MB), for validate_ordo's text.
  mcp.use(express.json({ limit: "5mb" }));

  mcp.post("/", async (req, res) => {
    const server = ordoServer(ws);
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Stateless servers have no stream to GET and no session to DELETE. Without
  // this, those fall through to the frontend and come back as index.html.
  mcp.all("/", (_req, res) => {
    res.status(405).set("Allow", "POST").end();
  });

  // A body the JSON parser refuses (too large, not JSON) answers in JSON-RPC,
  // which a client can show, rather than Express's HTML error page.
  const onError: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) return next(err);
    const status = (err as { status?: unknown }).status;
    if (typeof status !== "number" || status < 400 || status >= 500) return next(err);
    const message = status === 413 ? "The request is larger than 5 MB." : "The request is not valid JSON.";
    res.status(status).json({ jsonrpc: "2.0", error: { code: -32700, message }, id: null });
  };
  mcp.use(onError);

  return mcp;
}
