// TEST-ONLY. Nothing outside __tests__ may import this; production.test.ts
// checks that nothing does.
//
// Mermaid's sequence parser reaches for a DOM in a few places a browser always
// has and Node does not: DOMPurify for `title` and `box` labels, a CSS colour
// check for `box` fills. This hands Node one before Mermaid loads, so it must
// be imported ahead of anything that imports Mermaid.
import { JSDOM } from "jsdom";

export const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  Option: dom.window.Option,
  CSSStyleSheet: dom.window.CSSStyleSheet,
});

// jsdom implements the DOM but no SVG geometry. Only the oracle needs this —
// it runs Mermaid's real renderer, which measures every label.
export function shimTextGeometry() {
  Object.assign(dom.window.SVGElement.prototype, {
    getBBox(this: SVGElement) {
      const text = this.textContent ?? "";
      return { x: 0, y: 0, width: text.length * 8, height: 20 };
    },
  });
}
