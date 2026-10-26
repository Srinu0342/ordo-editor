// SVG on stdin ({ svg, zoom } as JSON) to PNG on stdout, with the bundled
// fonts only. A process of its own because resvg can panic on a drawing it
// can't place (seen with a marker drawn wholly outside the picture), and a
// panic in a native addon aborts the process that loaded it: here that is
// this one, not the editor's server. Plain JS, so node runs it as it is.
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const font = (name) => fileURLToPath(new URL(`./fonts/${name}`, import.meta.url));

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const { svg, zoom } = JSON.parse(Buffer.concat(chunks).toString("utf8"));

const png = new Resvg(svg, {
  fitTo: { mode: "zoom", value: zoom },
  font: {
    fontFiles: [font("LiberationSans-Regular.ttf"), font("LiberationSans-Bold.ttf")],
    loadSystemFonts: false,
    defaultFontFamily: "Liberation Sans",
  },
})
  .render()
  .asPng();
process.stdout.write(png);
