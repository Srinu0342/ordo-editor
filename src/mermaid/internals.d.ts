// The Mermaid internals the flowchart import reaches into (see ordo-layout.ts).

// Mermaid's own dagre layout, imported straight out of its build. It is not
// one of Mermaid's exports, so it ships without types.
declare module "mermaid/dist/chunks/mermaid.core/dagre-*.mjs" {
  export const render: Awaited<
    ReturnType<import("mermaid").LayoutLoaderDefinition["loader"]>
  >["render"];
}

// The positioned model the `ordo` layout leaves for the extractor to collect.
declare var __ordo_mermaid: import("mermaid").LayoutData | undefined;
