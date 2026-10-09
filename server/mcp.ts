import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { localhostHostValidation, localhostOriginValidation } from "@modelcontextprotocol/express";
import { readDiagram } from "../src/ordo/index.ts";
import { canonicalShape } from "../src/ordo/rf-mapping.ts";
import { SHAPE_GROUPS } from "../src/shapes/registry.ts";
import { SHAPE_ALIASES } from "../src/shapes/aliases.ts";

// MCP over Streamable HTTP, at /mcp on the same port as the editor.
//
// Stateless: every POST gets a fresh server and transport, and nothing is kept
// between calls. That suits the dev server, which `tsx watch` restarts on every
// edit; with sessions, each restart would cut the client off.
//
// The tools only reach what runs in Node. The diagram being drawn lives in the
// browser tab, so nothing here can see or change the canvas.

function ordoServer() {
  const server = new McpServer({ name: "ordo", version: "1.0.0" });

  server.registerTool(
    "validate_ordo",
    {
      title: "Validate an Ordo diagram",
      description:
        "Parse and validate the text of an Ordo .yml file: the structure document, optionally followed by `---` and the layout document. Returns ok plus the same diagnostics the editor's import dialog shows, with line and column where known.",
      inputSchema: z.object({ text: z.string().describe("The full contents of the .yml file") }),
      annotations: { readOnlyHint: true },
    },
    async ({ text }) => {
      const { ok, diagnostics } = readDiagram(text);
      return { content: [{ type: "text", text: JSON.stringify({ ok, diagnostics }, null, 2) }] };
    },
  );

  server.registerTool(
    "list_shapes",
    {
      title: "List the shapes a box can take",
      description:
        "Every value a box node's `shape:` field accepts: the registry's shapes by palette group, with label and default size, and the Mermaid aliases that resolve to them.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const groups = SHAPE_GROUPS.map(([id, title, set]) => ({
        id,
        title,
        shapes: Object.entries(set).map(([key, s]) => ({ key, label: s.label, size: s.size })),
      }));
      const aliases = Object.fromEntries(
        Object.keys(SHAPE_ALIASES).flatMap((alias) => {
          const key = canonicalShape(alias);
          return key && key !== alias ? [[alias, key]] : [];
        }),
      );
      return { content: [{ type: "text", text: JSON.stringify({ groups, aliases }, null, 2) }] };
    },
  );

  return server;
}

export const mcp = express.Router();

// No auth, so only local clients: a web page open in the browser could
// otherwise reach this through DNS rebinding or a cross-site POST.
mcp.use(localhostHostValidation(), localhostOriginValidation());
mcp.use(express.json());

mcp.post("/", async (req, res) => {
  const server = ordoServer();
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
