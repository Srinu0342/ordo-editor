export const render = async (data4Layout, svg, helpers, options) => {
  const dagre = await import('mermaid/dist/chunks/mermaid.core/dagre-6A5THRUB.mjs');
  await dagre.render(data4Layout, svg, helpers, options);
  globalThis.__ordo_mermaid = data4Layout;
};
