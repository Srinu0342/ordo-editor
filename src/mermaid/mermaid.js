import mermaid from "mermaid";

// The one configured Mermaid. Every importer goes through this instance, so the
// layout loader is registered and `initialize` has run before anything else —
// type detection included, which reads the detectors `initialize` installs.
//
// Pinned to mermaid@12.0.0 in package.json: both importers read structures
// that are parse output rather than documented API.

mermaid.registerLayoutLoaders([
  { name: "ordo", loader: async () => await import("./ordo-layout.js") },
]);

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  layout: "ordo",
});

export default mermaid;
