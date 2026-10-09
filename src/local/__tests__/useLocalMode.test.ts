// Local mode's flows end to end, against an in-memory repo served the way
// server/api.ts serves one: open, settle, sync both ways, conflicts, deleted
// files, switching tabs with and without unsynced edits, and the address bar.
//
// JSDOM measures nothing and there is no React Flow here, so the harness
// stands in for its `nodesInitialized`: a new graph reads as unmeasured for
// one commit and measured after, which is the transition settling waits for.
import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseAllDocuments } from "yaml";
import { JSDOM } from "jsdom";
import type { Dispatch, SetStateAction } from "react";

const { window } = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  localStorage: window.localStorage,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { act, createElement, useEffect, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useLocalMode } = await import("../useLocalMode.ts");
const { useHistory } = await import("../../useHistory.ts");
const { emptySession, exportOrdo } = await import("../../ordo/index.ts");
const { makeNode } = await import("../../nodes/defaults.ts");
import type { OrdoSession } from "../../ordo/index.ts";
import type { OrdoEdge, OrdoNode } from "../../types.ts";
import type { SyncChoice } from "../../components/SyncDialog.tsx";

const fixture = (name: string) => readFileSync(new URL(`../../ordo/__tests__/fixtures/${name}`, import.meta.url), "utf8");
const ORDO = fixture("checkout.yml");
const CHECKOUT = `${ORDO}---\n${fixture("checkout.layout.yml")}`;
const SEQUENCE = fixture("sequence.yaml");
const FOUR_SPACE = parseAllDocuments(CHECKOUT)
  .map((doc) => (doc as { toString: (o: object) => string }).toString({ lineWidth: 0, indent: 4 }))
  .join("");
const EMPTY = "ordo: 1\nnodes: []\n---\nordo-layout: 1\n";
const REPO = "code/app";

// --- an in-memory repo behind a stubbed fetch --------------------------------

type Put = { tab: string; ifMatch: string | null; ifNoneMatch: string | null };

function fakeServer(t: TestContext, files: Record<string, string>) {
  let version = 0;
  const store = new Map<string, { text: string; etag: string }>();
  const set = (tab: string, text: string) => store.set(tab, { text, etag: `"v${++version}"` });
  for (const [tab, text] of Object.entries(files)) set(tab, text);
  const puts: Put[] = [];
  let beforePut: ((tab: string) => void) | null = null;

  const had = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url, "http://localhost");
    const method = init.method ?? "GET";
    const headers = (init.headers ?? {}) as Record<string, string>;
    assert.equal(u.searchParams.get("repo") ?? REPO, REPO);
    if (u.pathname === "/api/workspace") return Response.json({ label: "~" });
    if (u.pathname === "/api/diagrams" && method === "GET")
      return Response.json({ diagrams: [...store.keys()].sort((a, b) => a.localeCompare(b)) });
    if (u.pathname === "/api/diagrams" && method === "POST") {
      const { name } = JSON.parse(String(init.body));
      if (store.has(name)) return Response.json({ error: `There is already a diagram called "${name}".` }, { status: 409 });
      set(name, EMPTY);
      return Response.json(store.get(name), { status: 201, headers: { ETag: store.get(name)!.etag } });
    }
    const tab = decodeURIComponent(u.pathname.slice("/api/diagrams/".length));
    if (method === "GET") {
      const file = store.get(tab);
      return file ? new Response(file.text, { headers: { ETag: file.etag } }) : Response.json({ error: "no such diagram" }, { status: 404 });
    }
    if (method === "PUT") {
      puts.push({ tab, ifMatch: headers["If-Match"] ?? null, ifNoneMatch: headers["If-None-Match"] ?? null });
      const hook = beforePut;
      beforePut = null;
      hook?.(tab);
      const file = store.get(tab);
      const ok = headers["If-None-Match"] === "*" ? !file : file?.etag === headers["If-Match"];
      if (!ok) return Response.json({ error: "The file changed." }, { status: 412 });
      set(tab, String(init.body));
      return Response.json({ etag: store.get(tab)!.etag }, { headers: { ETag: store.get(tab)!.etag } });
    }
    throw new Error(`unexpected ${method} ${url}`);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = had;
  });

  return {
    text: (tab: string) => store.get(tab)?.text,
    etag: (tab: string) => store.get(tab)?.etag,
    edit: (tab: string, text: string) => set(tab, text), // an agent, or git, changing the file
    remove: (tab: string) => store.delete(tab),
    puts,
    onNextPut: (fn: (tab: string) => void) => {
      beforePut = fn;
    },
  };
}

// --- the editor, without React Flow ------------------------------------------

type View = {
  nodes: OrdoNode[];
  edges: OrdoEdge[];
  session: OrdoSession;
  setNodes: Dispatch<SetStateAction<OrdoNode[]>>;
  local: ReturnType<typeof useLocalMode>;
  undo: () => void;
  downloads: { text: string; name: string }[];
  notes: string[];
};

function mount(t: TestContext, url = "/") {
  window.history.replaceState(null, "", url);
  const view = { downloads: [], notes: [] } as unknown as View;
  function Editor() {
    const [nodes, setNodes] = useState<OrdoNode[]>([]);
    const [edges, setEdges] = useState<OrdoEdge[]>([]);
    const [session, setSession] = useState<OrdoSession>(() => emptySession());
    const [epoch, setEpoch] = useState(0);
    // React Flow's nodesInitialized, as far as settling reads it: a graph is
    // measured from the commit after it lands.
    const [measured, setMeasured] = useState<OrdoNode[] | null>(null);
    useEffect(() => setMeasured(nodes), [nodes]);
    const { undo } = useHistory({ nodes, edges, setNodes, setEdges, epoch });
    const local = useLocalMode({
      nodes,
      edges,
      nodesInitialized: nodes.length > 0 && measured === nodes,
      replaceCanvas: (n, e) => {
        setNodes(n);
        setEdges(e);
      },
      session,
      setSession,
      startNewHistory: () => setEpoch((x) => x + 1),
      download: (text, name) => view.downloads.push({ text, name }),
      notify: (message) => view.notes.push(message),
    });
    Object.assign(view, { nodes, edges, session, setNodes, local, undo });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Editor)));
  t.after(() => act(() => root.unmount()));
  return view;
}

const tick = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

async function until(what: string, ok: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await tick(10);
  }
}

const ready = (view: View) => until("the diagram to settle", () => view.local.state.mode === "local" && view.local.state.status === "ready" && view.local.settled);

const stateOf = (view: View) => {
  const s = view.local.state;
  assert.equal(s.mode, "local");
  return s as Extract<typeof s, { mode: "local" }>;
};

/** Start a flow, answer the question it asks with `choice`, and finish it. */
async function answering<T>(view: View, flow: () => Promise<T>, kind: string, choice: SyncChoice): Promise<T> {
  let done!: Promise<T>;
  await act(async () => {
    done = flow();
  });
  await until(`the ${kind} question`, () => view.local.question?.kind === kind);
  await act(async () => view.local.answer(choice));
  let result!: T;
  await act(async () => {
    result = await done;
  });
  return result;
}

const run = async <T>(flow: () => Promise<T>): Promise<T> => {
  let result!: T;
  await act(async () => {
    result = await flow();
  });
  return result;
};

const drag = (view: View, id: string, dx = 40) =>
  act(() => view.setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, position: { x: n.position.x + dx, y: n.position.y } } : n))));

// --- opening ------------------------------------------------------------------

test("a local URL opens its repo at its tab; reading the URL is all start-up does", async (t) => {
  const server = fakeServer(t, { checkout: CHECKOUT, auth: EMPTY });
  const view = mount(t, `/?source=local&repo=${REPO}&tab=checkout`);
  await ready(view);
  const s = stateOf(view);
  assert.equal(s.repo, REPO);
  assert.deepEqual(s.tabs, ["auth", "checkout"]);
  assert.equal(s.tab, "checkout");
  assert.equal(view.nodes.length, 7);
  assert.equal(view.local.label, "~");
  assert.deepEqual(server.puts, [], "opening writes nothing");
});

test("a URL naming no tab, or one that is gone, opens the first and says so in the address bar", async (t) => {
  fakeServer(t, { checkout: CHECKOUT, auth: EMPTY });
  const view = mount(t, `/?source=local&repo=${REPO}&tab=missing`);
  await ready(view);
  assert.equal(stateOf(view).tab, "auth");
  assert.equal(window.location.search, `?source=local&repo=${REPO}&tab=auth`);
});

for (const [name, text] of [
  ["the canonical checkout", CHECKOUT],
  ["a sequence diagram with tubes riding its lifelines", SEQUENCE],
  ["a file with no layout document", ORDO],
  ["a 4-space file", FOUR_SPACE],
] as const) {
  test(`a freshly opened diagram is not unsynced: ${name}`, async (t) => {
    fakeServer(t, { d: text });
    const view = mount(t, `/?source=local&repo=${REPO}&tab=d`);
    await ready(view);
    assert.ok(view.nodes.length > 0);
    assert.equal(view.local.unsyncedNow(), false);
    await tick(400); // the dot's debounce
    assert.equal(view.local.unsynced, false);
  });
}

test("a repo with no diagrams is empty, and the first + creates one", async (t) => {
  const server = fakeServer(t, {});
  const view = mount(t);
  await run(() => view.local.openRepo(REPO));
  assert.equal(stateOf(view).status, "empty");
  assert.equal(window.location.search, `?source=local&repo=${REPO}`);

  assert.equal(await run(() => view.local.createTab("billing")), null);
  await ready(view);
  assert.deepEqual(stateOf(view).tabs, ["billing"]);
  assert.equal(stateOf(view).tab, "billing");
  assert.equal(server.text("billing"), EMPTY);
  assert.equal(window.location.search, `?source=local&repo=${REPO}&tab=billing`);
  assert.equal(await run(() => view.local.createTab("billing")), 'There is already a diagram called "billing".');
});

// --- sync ---------------------------------------------------------------------

test("an edit makes the diagram unsynced; Sync writes it with the base ETag", async (t) => {
  const server = fakeServer(t, { checkout: CHECKOUT });
  const view = mount(t, `/?source=local&repo=${REPO}&tab=checkout`);
  await ready(view);
  const before = server.etag("checkout");

  drag(view, "api");
  assert.equal(view.local.unsyncedNow(), true);
  await until("the unsynced dot", () => view.local.unsynced);

  assert.equal(await run(() => view.local.sync()), true);
  assert.deepEqual(server.puts, [{ tab: "checkout", ifMatch: before, ifNoneMatch: null }]);
  const written = server.text("checkout")!;
  assert.equal(written, exportOrdo(view.nodes, view.edges, view.session).text);
  assert.equal(written.split("\n").filter((l, i) => l !== CHECKOUT.split("\n")[i]).length, 1, "a drag is one line");
  assert.equal(view.local.unsyncedNow(), false);

  // and the next edit writes against the new ETag
  drag(view, "db");
  await run(() => view.local.sync());
  assert.equal(server.puts[1].ifMatch, `"v2"`);
});

test("Sync with nothing changed on either side writes nothing", async (t) => {
  const server = fakeServer(t, { checkout: CHECKOUT });
  const view = mount(t, `/?source=local&repo=${REPO}&tab=checkout`);
  await ready(view);
  assert.equal(await run(() => view.local.sync()), true);
  assert.deepEqual(server.puts, []);
  assert.ok(view.notes.includes("Up to date"));
});

test("a file changed on disk loads on Sync when the canvas has no edits", async (t) => {
  const server = fakeServer(t, { checkout: CHECKOUT });
  const view = mount(t, `/?source=local&repo=${REPO}&tab=checkout`);
  await ready(view);
  server.edit("checkout", CHECKOUT.replace("label: Payments API", "label: Checkout API"));

  assert.equal(await run(() => view.local.sync()), true);
  await ready(view);
  assert.equal(view.nodes.find((n) => n.id === "api")!.data.label, "Checkout API");
  assert.deepEqual(server.puts, []);
  assert.equal(view.local.unsyncedNow(), false);
});

test("edits on both sides always ask; Keep mine writes over the file's ETag", async (t) => {
  const server = fakeServer(t, { checkout: CHECKOUT });
  const view = mount(t, `/?source=local&repo=${REPO}&tab=checkout`);
  await ready(view);
  drag(view, "api");
  server.edit("checkout", CHECKOUT.replace("label: Postgres", "label: Aurora"));
  const theirs = server.etag("checkout");

  assert.equal(await answering(view, () => view.local.sync(), "conflict", "cancel"), false);
  assert.deepEqual(server.puts, [], "Cancel writes nothing");

  assert.equal(await answering(view, () => view.local.sync(), "conflict", "keep"), true);
  assert.deepEqual(server.puts, [{ tab: "checkout", ifMatch: theirs, ifNoneMatch: null }]);
  assert.doesNotMatch(server.text("checkout")!, /Aurora/);
});

test("a conflict's Take the file's loads it, and Download mine saves the canvas without writing", async (t) => {
  const server = fakeServer(t, { checkout: CHECKOUT });
  const view = mount(t, `/?source=local&repo=${REPO}&tab=checkout`);
  await ready(view);
  drag(view, "api");
  server.edit("checkout", CHECKOUT.replace("label: Postgres", "label: Aurora"));

  assert.equal(await answering(view, () => view.local.sync(), "conflict", "download"), false);
  assert.equal(view.downloads.length, 1);
  assert.equal(view.downloads[0].name, "checkout.yaml");
  assert.equal(view.downloads[0].text, exportOrdo(view.nodes, view.edges, view.session).text);

  assert.equal(await answering(view, () => view.local.sync(), "conflict", "take"), true);
  await ready(view);
  assert.equal(view.nodes.find((n) => n.id === "db")!.data.label, "Aurora");
  assert.deepEqual(server.puts, []);
});

test("a file that changes between Sync's read and its write lands on the conflict question", async (t) => {
  const server = fakeServer(t, { checkout: CHECKOUT });
  const view = mount(t, `/?source=local&repo=${REPO}&tab=checkout`);
  await ready(view);
  drag(view, "api");
  server.onNextPut((tab) => server.edit(tab, CHECKOUT.replace("label: Postgres", "label: Aurora")));

  assert.equal(await answering(view, () => view.local.sync(), "conflict", "cancel"), false);
  assert.equal(server.puts.length, 1, "the 412 was not retried blindly");
  assert.match(server.text("checkout")!, /Aurora/);
});

test("a broken file shows its problems on Sync and is overwritten only through Keep mine", async (t) => {
  const server = fakeServer(t, { checkout: CHECKOUT });
  const view = mount(t, `/?source=local&repo=${REPO}&tab=checkout`);
  await ready(view);
  server.edit("checkout", "ordo: 1\nnodes: [\n");

  assert.equal(await answering(view, () => view.local.sync(), "invalid", "ok"), false);
  assert.ok(view.nodes.length, "nothing loaded");

  drag(view, "api");
  assert.equal(await answering(view, () => view.local.sync(), "conflict-invalid", "keep"), true);
  assert.match(server.text("checkout")!, /^# Checkout flow/);
});

test("a deleted file: Recreate from canvas writes it back with If-None-Match: *", async (t) => {
  const server = fakeServer(t, { checkout: CHECKOUT, auth: EMPTY });
  const view = mount(t, `/?source=local&repo=${REPO}&tab=checkout`);
  await ready(view);
  drag(view, "api");
  server.remove("checkout");

  assert.equal(await answering(view, () => view.local.sync(), "deleted", "recreate"), true);
  assert.deepEqual(server.puts, [{ tab: "checkout", ifMatch: null, ifNoneMatch: "*" }]);
  assert.ok(server.text("checkout"));
});

test("a deleted file with no edits closes its tab", async (t) => {
  const server = fakeServer(t, { checkout: CHECKOUT, auth: EMPTY });
  const view = mount(t, `/?source=local&repo=${REPO}&tab=checkout`);
  await ready(view);
  server.remove("checkout");
  assert.equal(await run(() => view.local.sync()), true);
  await ready(view);
  assert.deepEqual(stateOf(view).tabs, ["auth"]);
  assert.equal(stateOf(view).tab, "auth");
});

test("a diagram that doesn't read opens as invalid, and Sync loads it once it is fixed", async (t) => {
  const server = fakeServer(t, { checkout: "ordo: 1\nnodes: [\n" });
  const view = mount(t, `/?source=local&repo=${REPO}&tab=checkout`);
  await until("the invalid panel", () => view.local.state.mode === "local" && view.local.state.status === "invalid");
  assert.ok(stateOf(view).diagnostics?.some((d) => d.line !== undefined));
  assert.equal(view.nodes.length, 0);

  assert.equal(await run(() => view.local.sync()), false);
  assert.equal(stateOf(view).status, "invalid");
  server.edit("checkout", CHECKOUT);
  assert.equal(await run(() => view.local.sync()), true);
  await ready(view);
  assert.equal(view.nodes.length, 7);
});

// --- leaving a diagram --------------------------------------------------------

test("leaving a tab with unsynced edits asks: Cancel stays, Discard goes", async (t) => {
  fakeServer(t, { checkout: CHECKOUT, auth: EMPTY });
  const view = mount(t, `/?source=local&repo=${REPO}&tab=checkout`);
  await ready(view);
  drag(view, "api");

  await answering(view, () => view.local.selectTab("auth"), "leave-tab", "cancel");
  assert.equal(stateOf(view).tab, "checkout");
  assert.equal(window.location.search, `?source=local&repo=${REPO}&tab=checkout`);

  await answering(view, () => view.local.selectTab("auth"), "leave-tab", "discard");
  await ready(view);
  assert.equal(stateOf(view).tab, "auth");
  assert.equal(window.location.search, `?source=local&repo=${REPO}&tab=auth`);
});

test("Sync and switch writes first, then switches", async (t) => {
  const server = fakeServer(t, { checkout: CHECKOUT, auth: EMPTY });
  const view = mount(t, `/?source=local&repo=${REPO}&tab=checkout`);
  await ready(view);
  drag(view, "api");
  await answering(view, () => view.local.selectTab("auth"), "leave-tab", "sync");
  await ready(view);
  assert.equal(server.puts.length, 1);
  assert.equal(stateOf(view).tab, "auth");
});

test("after a tab switch, undo does nothing to the new diagram", async (t) => {
  fakeServer(t, { checkout: CHECKOUT, auth: EMPTY });
  const view = mount(t, `/?source=local&repo=${REPO}&tab=checkout`);
  await ready(view);
  // an edit closed into a step, as a click would
  drag(view, "api");
  act(() => void window.dispatchEvent(new window.MouseEvent("pointerdown", { button: 0 })));
  act(() => void window.dispatchEvent(new window.MouseEvent("pointerup", { button: 0 })));

  await answering(view, () => view.local.selectTab("auth"), "leave-tab", "discard");
  await ready(view);
  assert.equal(view.nodes.length, 0);
  act(() => view.undo());
  act(() => view.undo());
  assert.equal(view.nodes.length, 0, "the old diagram's nodes did not come back");
});

test("Back and Forward move between tabs; Cancel on unsynced edits puts the address back", async (t) => {
  fakeServer(t, { checkout: CHECKOUT, auth: EMPTY });
  const view = mount(t, `/?source=local&repo=${REPO}&tab=checkout`);
  await ready(view);
  await run(() => view.local.selectTab("auth"));
  await ready(view);

  const back = async () => {
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 20)); // JSDOM fires popstate a task later
    });
  };
  await back();
  await ready(view);
  assert.equal(stateOf(view).tab, "checkout");

  drag(view, "api");
  let asked = false;
  const watch = until("the leave question", () => (asked = view.local.question?.kind === "leave-tab"));
  await act(async () => {
    window.history.forward();
  });
  await watch;
  assert.ok(asked);
  await act(async () => view.local.answer("cancel"));
  await tick(20);
  assert.equal(stateOf(view).tab, "checkout");
  assert.equal(window.location.search, `?source=local&repo=${REPO}&tab=checkout`);
});

test("leaving free-form with a drawing asks first, and Download saves it", async (t) => {
  fakeServer(t, { checkout: CHECKOUT });
  const view = mount(t);
  const draft = makeNode("rect", { id: "n1", position: { x: 0, y: 0 } });
  act(() => view.setNodes([{ ...draft, data: { ...draft.data, label: "draft" } }]));
  await answering(view, () => view.local.openRepo(REPO), "leave-free", "cancel");
  assert.equal(view.local.state.mode, "free");

  await answering(view, () => view.local.openRepo(REPO), "leave-free", "download");
  await ready(view);
  assert.equal(view.downloads[0].name, "diagram.yaml");
  assert.match(view.downloads[0].text, /draft/);
  assert.equal(stateOf(view).tab, "checkout");
});

test("a drawing that can't be written isn't downloaded, and free-form stays", async (t) => {
  fakeServer(t, { checkout: CHECKOUT });
  const view = mount(t);
  // a field the format has no place for: export refuses it
  act(() => view.setNodes([{ id: "n1", type: "box", position: { x: 0, y: 0 }, data: { shape: "rect", color: "red" } } as OrdoNode]));
  await answering(view, () => view.local.openRepo(REPO), "leave-free", "download");
  assert.equal(view.local.state.mode, "free");
  assert.deepEqual(view.downloads, []);
  assert.match(view.notes.at(-1) ?? "", /can't be written/);
});

test("going back to free-form clears the canvas and the address", async (t) => {
  fakeServer(t, { checkout: CHECKOUT });
  const view = mount(t, `/?source=local&repo=${REPO}&tab=checkout`);
  await ready(view);
  await run(() => view.local.goFree());
  assert.equal(view.local.state.mode, "free");
  assert.equal(view.nodes.length, 0);
  assert.equal(window.location.pathname + window.location.search, "/");
});
