// The two Ordo dialogs, driven the way a person drives them: paste into the
// box, read the diagnostics, press Import (and Replace), Copy.
import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// React DOM looks for a DOM when it loads, so the window goes up first.
const { window } = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
});
// Node has a navigator of its own, behind a getter; the dialogs read the DOM's.
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ReactFlowProvider } = await import("@xyflow/react");
const { default: OrdoImportDialog } = await import("../components/OrdoImportDialog.tsx");
const { default: ViewYamlDialog } = await import("../components/ViewYamlDialog.tsx");
const { importOrdo } = await import("../ordo/index.ts");
const { TUBE_TYPE } = await import("../nodes/tube.ts");
import type { OrdoImportResult } from "../components/OrdoImportDialog.tsx";
import type { OrdoSession } from "../ordo/index.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`../ordo/__tests__/fixtures/${name}`, import.meta.url), "utf8");
const ORDO = fixture("checkout.yml");
const LAYOUT = fixture("checkout.layout.yml");
const BUNDLE = `${ORDO}---\n${LAYOUT}`; // the one file: structure, ---, layout
const BROKEN = fixture("broken.yml");

function mount(t: TestContext, element: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(element));
  t.after(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

// React listens for `input`; the value has to go through the native setter
// for it to notice the change.
function type(area: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(area, value);
    area.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

const click = (el: HTMLElement | undefined) => {
  assert.ok(el, "element to click");
  act(() => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
};

// ---------------------------------------------------------------------------

test("Import  Ordo YAML: pasting the fixture pair imports 7 nodes and 4 edges", (t) => {
  const imports: OrdoImportResult[] = [];
  let closed = 0;
  const host = mount(
    t,
    createElement(OrdoImportDialog, {
      open: true,
      canvasEmpty: true,
      onClose: () => closed++,
      onImport: (r: OrdoImportResult) => imports.push(r),
    }),
  );
  type(host.querySelector<HTMLTextAreaElement>("#ordo-import-diagram")!, BUNDLE);
  assert.match(host.textContent ?? "", /Valid Ordo v1: structure and layout/);
  const importButton = button(host, "Import")!;
  assert.equal(importButton.disabled, false);
  click(importButton);
  assert.equal(imports.length, 1);
  assert.equal(imports[0].nodes.length, 7);
  assert.equal(imports[0].edges.length, 4);
  assert.equal(imports[0].name, "diagram"); // pasted, so no file name
  assert.ok(imports[0].ordo && imports[0].layout);
  assert.equal(closed, 1);
});

test("Import  Ordo YAML: the broken file lists its diagnostics by line and keeps Import disabled", (t) => {
  const host = mount(
    t,
    createElement(OrdoImportDialog, { open: true, canvasEmpty: true, onClose: () => {}, onImport: () => {} }),
  );
  type(host.querySelector<HTMLTextAreaElement>("#ordo-import-diagram")!, BROKEN);
  const text = host.textContent ?? "";
  for (const where of ["6:9", "8:30", "12:7", "13:5", "16:14"]) assert.ok(text.includes(where), where);
  assert.match(text, /5 errors/);
  assert.equal(button(host, "Import")!.disabled, true);
});

test("Import  Ordo YAML: a layout on its own says the structure is missing", (t) => {
  const host = mount(
    t,
    createElement(OrdoImportDialog, { open: true, canvasEmpty: true, onClose: () => {}, onImport: () => {} }),
  );
  type(host.querySelector<HTMLTextAreaElement>("#ordo-import-diagram")!, LAYOUT);
  assert.match(host.textContent ?? "", /no structure document/);
  assert.equal(button(host, "Import")!.disabled, true);
});

test("Import  Ordo YAML: the structure alone imports, laid out automatically", (t) => {
  const imports: OrdoImportResult[] = [];
  const host = mount(
    t,
    createElement(OrdoImportDialog, {
      open: true,
      canvasEmpty: true,
      onClose: () => {},
      onImport: (r: OrdoImportResult) => imports.push(r),
    }),
  );
  type(host.querySelector<HTMLTextAreaElement>("#ordo-import-diagram")!, ORDO);
  assert.match(host.textContent ?? "", /no layout, so it will be laid out on import/);
  click(button(host, "Import"));
  assert.equal(imports[0].nodes.length, 7);
  assert.equal(imports[0].layout, null);
});

test("Import  Ordo YAML: replacing a non-empty canvas asks first", (t) => {
  const imports: OrdoImportResult[] = [];
  const host = mount(
    t,
    createElement(OrdoImportDialog, {
      open: true,
      canvasEmpty: false,
      onClose: () => {},
      onImport: (r: OrdoImportResult) => imports.push(r),
    }),
  );
  type(host.querySelector<HTMLTextAreaElement>("#ordo-import-diagram")!, ORDO);
  click(button(host, "Import"));
  assert.equal(imports.length, 0);
  assert.match(host.textContent ?? "", /Replace the current diagram\?/);
  click(button(host, "Replace"));
  assert.equal(imports.length, 1);
});

// ---------------------------------------------------------------------------

function viewer(t: TestContext, nodes: object[], edges: object[], session: OrdoSession) {
  const exported: unknown[] = [];
  const host = mount(
    t,
    createElement(
      ReactFlowProvider,
      { initialNodes: nodes, initialEdges: edges } as never,
      createElement(ViewYamlDialog, {
        open: true,
        onClose: () => {},
        session,
        onExported: (docs: unknown) => exported.push(docs),
      }),
    ),
  );
  return { host, exported };
}

test("View Ordo YAML: one file, exactly as imported, and Copy copies all of it", async (t) => {
  const imported = importOrdo(BUNDLE);
  const session: OrdoSession = { name: "checkout", ordo: imported.ordo, layout: imported.layout };
  const { host, exported } = viewer(t, imported.nodes, imported.edges, session);

  assert.match(host.textContent ?? "", /checkout\.yaml/);
  assert.equal(host.querySelectorAll("pre").length, 1);
  assert.equal(host.querySelector("pre")!.textContent, BUNDLE);
  assert.equal(exported.length, 1); // the patched documents went back to the session

  const copied: string[] = [];
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  Object.defineProperty(window.navigator, "clipboard", {
    value: { writeText: async (text: string) => void copied.push(text) },
    configurable: true,
  });

  await act(async () => {
    button(host, "Copy")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  assert.deepEqual(copied, [BUNDLE]);
});

test("View Ordo YAML: a sequence diagram's nodes are written like any others", (t) => {
  const { host } = viewer(
    t,
    [{ id: "bar", type: TUBE_TYPE, position: { x: 0, y: 0 }, style: { width: 26, height: 220 }, data: { slots: 3 } }],
    [],
    { name: "diagram", ordo: null, layout: null },
  );
  assert.equal(
    host.querySelector("pre")?.textContent,
    "ordo: 1\nnodes:\n  - bar\ndata:\n  nodes:\n    bar:\n      kind: tube\n      slots: 3\n---\nordo-layout: 1\nnodes:\n  bar: { x: 0, y: 0 }\n",
  );
});

test("View Ordo YAML: a field from outside the editor is named, and nothing is written", (t) => {
  const imported = importOrdo(ORDO, LAYOUT);
  const nodes = imported.nodes.map((n) => (n.id === "api" ? { ...n, data: { ...n.data, color: "red" } } : n));
  const { host, exported } = viewer(t, nodes, imported.edges, { name: "checkout", ordo: imported.ordo, layout: imported.layout });
  assert.match(host.textContent ?? "", /This canvas can't be exported as Ordo YAML/);
  assert.match(host.textContent ?? "", /data\.color/);
  assert.equal(exported.length, 0);
});

test("View Ordo YAML: Download saves exactly what is shown, as <name>.yaml", async (t) => {
  const imported = importOrdo(BUNDLE);
  const { host } = viewer(t, imported.nodes, imported.edges, { name: "checkout", ordo: imported.ordo, layout: imported.layout });

  // A download is a blob URL on a link that is clicked: record both.
  const blobs = new Map<string, Blob>();
  const saved: { name: string; href: string }[] = [];
  const was = { create: URL.createObjectURL, revoke: URL.revokeObjectURL, click: window.HTMLAnchorElement.prototype.click };
  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:test/${blobs.size}`;
    blobs.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, href: this.getAttribute("href")! });
  };
  t.after(() => {
    URL.createObjectURL = was.create;
    URL.revokeObjectURL = was.revoke;
    window.HTMLAnchorElement.prototype.click = was.click;
  });

  click(button(host, "Download"));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, "checkout.yaml");
  assert.equal(await blobs.get(saved[0].href)!.text(), BUNDLE);
  assert.equal(document.querySelectorAll("a[download]").length, 0, "the link is gone again");
});
