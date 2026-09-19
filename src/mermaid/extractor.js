import mermaid from 'mermaid';

mermaid.registerLayoutLoaders([
  { name: 'ordo', loader: async () => await import('./ordo-layout.js') },
]);

mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', layout: 'ordo' });

export const getMermaidLayoutForOrdo = async (src, graphId) => {
  try {
    await mermaid.render(graphId, src);

    const diagram = await mermaid.mermaidAPI.getDiagramFromText(src);

    const db = diagram.db;
    
    const subgraphs = db.getSubGraphs?.();

    return { mermaid: globalThis.__ordo_mermaid, subgraphs };
  } catch (error) {
    console.error('Error rendering Mermaid layout:', error);
  }
};
