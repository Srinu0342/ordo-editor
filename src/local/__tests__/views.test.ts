// Each diagram's last view: kept per repo and tab, carried by a rename, gone
// with the diagram, capped, and harmless when storage is not.
import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { forgetView, moveView, rememberView, savedView, VIEWS_LIMIT } from "../views.ts";

function withStorage(t: TestContext, storage: unknown) {
  const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  t.after(() => {
    if (had) Object.defineProperty(globalThis, "localStorage", had);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });
}

const memory = () => {
  const items = new Map<string, string>();
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    items,
  };
};

const at = (x: number, y = 0, zoom = 1) => ({ x, y, zoom });

test("a diagram's view comes back for that repo and tab only", (t) => {
  withStorage(t, memory());
  assert.equal(savedView("api", "main"), null);
  rememberView("api", "main", at(10, 20, 0.5));
  rememberView("api", "main", at(30, 40, 1.5));
  rememberView("web", "main", at(1));
  assert.deepEqual(savedView("api", "main"), at(30, 40, 1.5));
  assert.deepEqual(savedView("web", "main"), at(1));
  assert.equal(savedView("api", "other"), null);
});

test("names that would run together stay apart", (t) => {
  withStorage(t, memory());
  rememberView("a/b", "c", at(1));
  assert.equal(savedView("a", "b/c"), null);
});

test("a rename carries the view, and a gone diagram forgets it", (t) => {
  withStorage(t, memory());
  rememberView("api", "main", at(5));
  moveView("api", "main", "checkout");
  assert.equal(savedView("api", "main"), null);
  assert.deepEqual(savedView("api", "checkout"), at(5));
  forgetView("api", "checkout");
  assert.equal(savedView("api", "checkout"), null);
});

test("past the limit the view touched longest ago goes", (t) => {
  withStorage(t, memory());
  for (let i = 0; i < VIEWS_LIMIT; i++) rememberView("r", `t${i}`, at(i));
  rememberView("r", "t0", at(99)); // touched again: now the newest
  rememberView("r", "new", at(1));
  assert.deepEqual(savedView("r", "t0"), at(99));
  assert.equal(savedView("r", "t1"), null);
  assert.deepEqual(savedView("r", "new"), at(1));
});

test("junk under the key reads as nothing remembered", (t) => {
  const store = memory();
  withStorage(t, store);
  store.items.set("ordo.views", "{not json");
  assert.equal(savedView("r", "t"), null);
  store.items.set("ordo.views", JSON.stringify({ [JSON.stringify(["r", "t"])]: { x: 1, y: "2", zoom: 0 } }));
  assert.equal(savedView("r", "t"), null);
});

test("a storage that throws reads as nothing remembered and never throws", (t) => {
  withStorage(t, {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  });
  assert.equal(savedView("r", "t"), null);
  rememberView("r", "t", at(1));
  moveView("r", "t", "u");
  forgetView("r", "t");
});
