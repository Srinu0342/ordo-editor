// Draw a diagram file to a PNG from the command line, as render_ordo draws it:
//
//   npx tsx server/render/cli.ts <repo>/.ordo/<name>/ordo.yaml [out.png]
//
// Writes next to the file as <name>.png when no output is given, and the SVG
// beside the PNG with --svg.
import fs from "node:fs/promises";
import path from "node:path";
import { renderDiagram } from "./png.ts";

const args = process.argv.slice(2);
const svgToo = args.includes("--svg");
const [file, out] = args.filter((a) => a !== "--svg");
if (!file) {
  console.error("usage: npx tsx server/render/cli.ts <ordo.yaml> [out.png] [--svg]");
  process.exit(2);
}

const target = out ?? path.join(path.dirname(file), `${path.basename(path.dirname(file))}.png`);
const started = performance.now();
const result = await renderDiagram(await fs.readFile(file, "utf8"));
if (!result.ok) {
  for (const d of result.diagnostics) console.error(`${d.line ?? "-"}:${d.col ?? "-"} ${d.message}`);
  process.exit(1);
}
await fs.writeFile(target, result.png);
if (svgToo) await fs.writeFile(target.replace(/\.png$/, "") + ".svg", result.svg);
console.log(`${target}: ${result.width} × ${result.height}, ${Math.round(performance.now() - started)} ms`);
