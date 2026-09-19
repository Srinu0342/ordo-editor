// ordo.theme — the token vocabulary the op-list references.
//
// This is WS3's hand-back to WS1: whatever ends up here becomes the schema of
// the theme block in the file format. Tokens are flat and namespaced by role
// rather than by component, so a third-party node package declares the tokens
// it needs and a document theme can satisfy them without knowing the package.

export const LIGHT = {
  "node.fill": "#ffffff",
  "node.stroke": "#94a3b8",
  "node.stroke.selected": "#6366f1",
  "node.rule": "#cbd5e1",
  "node.ink": "#0f172a",
  "node.ink.muted": "#64748b",
  "node.shade": "#f1f5f9",
  "node.accent": "#6366f1",

  "container.fill": "transparent",
  "container.stroke": "#94a3b8",
  "container.band": "#f8fafc",

  "edge.stroke": "#0f172a",
  "canvas.bg": "#ffffff",
  "canvas.grid": "#e2e8f0",
};

export const DARK = {
  ...LIGHT,
  "node.fill": "#161e26",
  "node.stroke": "#64748b",
  "node.rule": "#334155",
  "node.ink": "#e2e8f0",
  "node.ink.muted": "#94a3b8",
  "node.shade": "#1e293b",
  "container.band": "#111827",
  "edge.stroke": "#e2e8f0",
  "canvas.bg": "#0f151b",
  "canvas.grid": "#1e293b",
};

export const THEMES = { light: LIGHT, dark: DARK };

// Resolution is the renderer's job, never the generator's. Unknown tokens fall
// through as literals so a shape can still hardcode a colour in a pinch and a
// typo shows up as an obviously wrong colour rather than a silent black.
export const resolve = (theme, token) => {
  if (token == null || token === "none" || token === "transparent")
    return token;
  return theme[token] ?? token;
};
