import express from "express";

// Everything under /api. Mounted ahead of the frontend, so a route here wins
// over a page of the same name.
export const api = express.Router();

api.use(express.json());

api.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Without this, an unknown /api path falls through to the frontend and comes
// back as index.html with a 200, which a fetch would happily try to parse.
api.use((req, res) => {
  res.status(404).json({ error: `no route for ${req.method} ${req.originalUrl}` });
});
