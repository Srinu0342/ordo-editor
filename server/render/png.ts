import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Diagnostic } from "../../src/ordo/index.ts";
import { buildScene } from "./scene.ts";
import { sceneToSvg } from "./svg.ts";

// A diagram as a PNG, for a model to look at: the scene, drawn to SVG, then
// rasterised by resvg with the bundled fonts only, so the picture is the same
// on every machine. resvg runs in a child process (see rasterize.mjs), so a
// drawing it chokes on fails this one render and nothing else.

const RASTERIZE = fileURLToPath(new URL("./rasterize.mjs", import.meta.url));

// A model is shown an image at most about this many px on its long side, and
// smaller drawings are drawn at twice the size, so small text stays sharp.
const LONG_SIDE = 1568;
const MAX_SCALE = 2;
const TIMEOUT_MS = 20_000;

export type Rendered =
  | { ok: true; png: Buffer; svg: string; width: number; height: number }
  | { ok: false; diagnostics: Diagnostic[] };

/** SVG to PNG at `zoom`, in a child process; rejects, rather than crashing this one, when resvg can't draw it. */
export function rasterize(svg: string, zoom: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [RASTERIZE], { stdio: ["pipe", "pipe", "pipe"], timeout: TIMEOUT_MS });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) return resolve(Buffer.concat(out));
      const why = Buffer.concat(err).toString("utf8").trim().split("\n")[0] || `exit ${code ?? signal}`;
      reject(new Error(`the rasteriser failed: ${why}`));
    });
    child.stdin.end(JSON.stringify({ svg, zoom }));
  });
}

// A PNG's size, from its IHDR chunk.
const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

/** Draw the diagram in `text`, or say why it can't be drawn (its errors). */
export async function renderDiagram(text: string): Promise<Rendered> {
  const { scene, diagnostics } = buildScene(text);
  if (!scene) return { ok: false, diagnostics: diagnostics.filter((d) => d.severity === "error") };
  const { svg, width, height } = sceneToSvg(scene);
  const png = await rasterize(svg, Math.min(MAX_SCALE, LONG_SIDE / Math.max(width, height)));
  return { ok: true, png, svg, ...pngSize(png) };
}
