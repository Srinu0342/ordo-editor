// Local mode's pieces of UI, driven the way a person drives them: the repo
// picker walking folders, the tab bar's `+` checking a name, and the sync
// dialog offering exactly its choices.
import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// A real origin, so localStorage works (the picker's recent repos).
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
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: RepoPickerDialog } = await import("../components/RepoPickerDialog.tsx");
const { default: TabBar } = await import("../components/TabBar.tsx");
const { default: SyncDialog, SYNC_CHOICES } = await import("../components/SyncDialog.tsx");
const { default: LocalPanel } = await import("../components/LocalPanel.tsx");
const { rememberRepo } = await import("../local/recent.ts");
import type { SyncChoice, SyncQuestionKind } from "../components/SyncDialog.tsx";

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

// Lets fetches resolve and React render what they brought.
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

const buttons = (host: HTMLElement) => [...host.querySelectorAll("button")];
const button = (host: HTMLElement, text: string) =>
  buttons(host).find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
const click = (el: Element | undefined) => {
  assert.ok(el, "element to click");
  act(() => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
};

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

// A workspace of folders, served the way server/api.ts serves them.
const TREE: Record<string, { name: string; git: boolean; ordo: boolean }[]> = {
  "": [
    { name: "code", git: false, ordo: false },
    { name: "notes", git: false, ordo: false },
  ],
  code: [
    { name: "payments-api", git: true, ordo: true },
    { name: "web", git: true, ordo: false },
  ],
};

function stubFolders(t: TestContext) {
  const asked: string[] = [];
  const had = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const u = new URL(url, "http://localhost");
    if (u.pathname === "/api/workspace") return Response.json({ label: "~" });
    const path = u.searchParams.get("path") ?? "";
    asked.push(path);
    const folders = TREE[path];
    return folders ? Response.json({ path, folders, truncated: false }) : Response.json({ error: "gone" }, { status: 404 });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = had;
    localStorage.clear();
  });
  return asked;
}

// ---------------------------------------------------------------------------
// The repo picker

test("the picker lists the root, goes into a folder, and opens a row", async (t) => {
  const asked = stubFolders(t);
  const opened: string[] = [];
  const host = mount(t, createElement(RepoPickerDialog, { open: true, onClose: () => {}, onOpen: (r: string) => opened.push(r) }));
  await flush();
  assert.deepEqual(asked, [""]);
  assert.ok(button(host, "Open this folder"));

  click([...host.querySelectorAll("button")].find((b) => b.title === "Go into code"));
  await flush();
  assert.deepEqual(asked, ["", "code"]);
  const text = host.textContent ?? "";
  assert.match(text, /payments-api/);
  assert.match(text, /\.ordo/, "a repo that already has diagrams is marked");
  assert.match(text, /git/);

  click(buttons(host).find((b) => b.title === "Open code/payments-api"));
  assert.deepEqual(opened, ["code/payments-api"]);
});

test("the picker opens the folder it is showing, from the breadcrumb back to the root", async (t) => {
  stubFolders(t);
  const opened: string[] = [];
  const host = mount(t, createElement(RepoPickerDialog, { open: true, onClose: () => {}, onOpen: (r: string) => opened.push(r) }));
  await flush();
  click(buttons(host).find((b) => b.title === "Go into code"));
  await flush();
  click(button(host, "Open this folder"));
  assert.deepEqual(opened, ["code"]);

  click(button(host, "~")); // the breadcrumb's root
  await flush();
  assert.match(host.textContent ?? "", /notes/);
});

test("the picker shows recent repos on top, and starts where it was last", async (t) => {
  const asked = stubFolders(t);
  rememberRepo("code/web");
  rememberRepo("code/payments-api");
  localStorage.setItem("ordo.pickerPath", "code");
  const opened: string[] = [];
  const host = mount(t, createElement(RepoPickerDialog, { open: true, onClose: () => {}, onOpen: (r: string) => opened.push(r) }));
  await flush();
  assert.deepEqual(asked, ["code"]);
  const recent = buttons(host).filter((b) => b.title.startsWith("Open code/"));
  assert.equal(recent[0].textContent, "code/payments-api", "newest first");
  click(button(host, "code/web"));
  assert.deepEqual(opened, ["code/web"]);
});

test("a folder that has gone since last time falls back to the root; a 404 elsewhere is a sentence", async (t) => {
  const asked = stubFolders(t);
  localStorage.setItem("ordo.pickerPath", "gone/away");
  const host = mount(t, createElement(RepoPickerDialog, { open: true, onClose: () => {}, onOpen: () => {} }));
  await flush();
  await flush();
  assert.deepEqual(asked, ["gone/away", ""]);
  assert.match(host.textContent ?? "", /notes/);

  TREE.notes = undefined as never; // listed, but gone by the time it is opened
  click(buttons(host).find((b) => b.title === "Go into notes"));
  await flush();
  assert.match(host.textContent ?? "", /doesn't exist any more/);
  assert.equal(button(host, "Open this folder")!.disabled, true);
});

// ---------------------------------------------------------------------------
// The tab bar

function tabBar(t: TestContext, tabs: string[], onCreate: (name: string) => Promise<string | null> = async () => null) {
  const selected: string[] = [];
  const host = mount(
    t,
    createElement(TabBar, { tabs, active: tabs[0] ?? null, unsynced: true, onSelect: (n: string) => selected.push(n), onCreate }),
  );
  return { host, selected };
}

test("tabs are listed as given, the open one marked unsynced, and a click selects another", (t) => {
  const { host, selected } = tabBar(t, ["auth", "checkout"]);
  const tabs = [...host.querySelectorAll('[role="tab"]')];
  assert.deepEqual(tabs.map((b) => b.textContent), ["auth", "checkout"]);
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");
  assert.ok(tabs[0].querySelector('[aria-label="unsynced changes"]'));
  click(tabs[0]); // the open one: nothing
  click(tabs[1]);
  assert.deepEqual(selected, ["checkout"]);
});

test("+ checks the name as it is typed: device names, case clashes and a trailing dot are refused", (t) => {
  const created: string[] = [];
  const { host } = tabBar(t, ["auth"], async (n) => (created.push(n), null));
  click(button(host, "+"));
  const input = host.querySelector<HTMLInputElement>('input[aria-label="New diagram name"]')!;
  assert.ok(input);

  for (const [name, said] of [
    ["con", /Windows reserves/],
    ["Auth", /already a diagram called "auth"/],
    ["billing.", /can't end with a space or a dot/],
  ] as const) {
    type(input, name);
    assert.match(host.querySelector('[role="alert"]')?.textContent ?? "", said, name);
    assert.equal(button(host, "Create")!.disabled, true, name);
  }
  assert.deepEqual(created, []);

  type(input, "billing");
  assert.equal(host.querySelector('[role="alert"]'), null);
  assert.equal(button(host, "Create")!.disabled, false);
});

test("+ creates on Enter, closes on success, and shows the server's reason when it says no", async (t) => {
  const replies: (string | null)[] = ['There is already a diagram called "Billing".', null];
  const created: string[] = [];
  const { host } = tabBar(t, ["auth"], async (n) => (created.push(n), replies.shift()!));
  click(button(host, "+"));
  const input = host.querySelector<HTMLInputElement>('input[aria-label="New diagram name"]')!;
  type(input, "billing");
  const enter = () => act(() => input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));

  enter();
  await flush();
  assert.match(host.querySelector('[role="alert"]')?.textContent ?? "", /already a diagram called "Billing"/);
  assert.ok(host.querySelector('input[aria-label="New diagram name"]'), "the field stays open");

  enter();
  await flush();
  assert.deepEqual(created, ["billing", "billing"]);
  assert.equal(host.querySelector('input[aria-label="New diagram name"]'), null, "closed once it exists");
});

test("Esc drops the name field", (t) => {
  const { host } = tabBar(t, []);
  click(button(host, "+"));
  const input = host.querySelector<HTMLInputElement>('input[aria-label="New diagram name"]')!;
  act(() => input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(host.querySelector("input"), null);
  assert.ok(button(host, "+"));
});

// ---------------------------------------------------------------------------
// The sync dialog

const EXPECTED: Record<SyncQuestionKind, string[]> = {
  conflict: ["Keep mine", "Take the file's", "Download mine", "Cancel"],
  "conflict-invalid": ["Keep mine", "Download mine", "Cancel"],
  deleted: ["Recreate from canvas", "Close tab", "Cancel"],
  invalid: ["OK"],
  blocked: ["OK"],
  "blocked-take": ["Take the file's", "Cancel"],
  "leave-tab": ["Sync and switch", "Discard and switch", "Cancel"],
  "leave-free": ["Download", "Discard", "Cancel"],
};

test("each sync question offers exactly its choices, and each button answers with its own", (t) => {
  assert.deepEqual(Object.keys(SYNC_CHOICES).sort(), Object.keys(EXPECTED).sort());
  for (const kind of Object.keys(EXPECTED) as SyncQuestionKind[]) {
    const chosen: SyncChoice[] = [];
    const host = mount(t, createElement(SyncDialog, { question: { kind, tab: "checkout" }, onChoice: (c: SyncChoice) => chosen.push(c) }));
    const labels = buttons(host)
      .filter((b) => b.getAttribute("aria-label") !== "Close")
      .map((b) => b.textContent?.trim());
    assert.deepEqual(labels, EXPECTED[kind], kind);
    for (const label of EXPECTED[kind]) click(button(host, label));
    assert.deepEqual(chosen, SYNC_CHOICES[kind].map((o) => o.choice), kind);
  }
});

test("Esc answers with the safe choice, never an overwrite", (t) => {
  const chosen: SyncChoice[] = [];
  const host = mount(t, createElement(SyncDialog, { question: { kind: "conflict", tab: "checkout" }, onChoice: (c: SyncChoice) => chosen.push(c) }));
  act(() => host.querySelector('[role="dialog"]')!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.deepEqual(chosen, ["cancel"]);
});

test("a file that does not read shows its problems with line and column", (t) => {
  const host = mount(
    t,
    createElement(SyncDialog, {
      question: {
        kind: "invalid",
        tab: "checkout",
        fileDiagnostics: [{ severity: "error", code: "yaml-syntax", message: "Map keys must be unique", file: "ordo", line: 6, col: 9 }],
      },
      onChoice: () => {},
    }),
  );
  const text = host.textContent ?? "";
  assert.match(text, /checkout\/ordo\.yaml/);
  assert.match(text, /6:9/);
  assert.match(text, /Map keys must be unique/);
});

// ---------------------------------------------------------------------------
// The panel over the canvas

test("a repo that can't be opened offers another repo, or free-form", (t) => {
  const picked: string[] = [];
  const host = mount(
    t,
    createElement(LocalPanel, {
      kind: "error",
      repo: "code/gone",
      message: "There is no such folder under the workspace root.",
      onCreate: async () => null,
      onOpenRepo: () => picked.push("repo"),
      onFree: () => picked.push("free"),
    }),
  );
  assert.match(host.textContent ?? "", /Can't open code\/gone/);
  click(button(host, "Open another repo"));
  click(button(host, "Free-form"));
  assert.deepEqual(picked, ["repo", "free"]);
});

test("an empty repo offers a first diagram, by the same name rules", (t) => {
  const created: string[] = [];
  const host = mount(
    t,
    createElement(LocalPanel, {
      kind: "empty",
      repo: "code/web",
      onCreate: async (n: string) => (created.push(n), null),
      onOpenRepo: () => {},
      onFree: () => {},
    }),
  );
  assert.match(host.textContent ?? "", /No diagrams in code\/web yet/);
  click(button(host, "+ New diagram"));
  const input = host.querySelector<HTMLInputElement>('input[aria-label="New diagram name"]')!;
  type(input, "nul.txt");
  assert.match(host.querySelector('[role="alert"]')?.textContent ?? "", /Windows reserves/);
});
