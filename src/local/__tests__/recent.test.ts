// The picker's memory: newest first, capped, and harmless when storage is not.
import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { lastPickerPath, recentRepos, rememberPickerPath, rememberRepo, RECENT_LIMIT } from "../recent.ts";

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

test("repos come back newest first, without repeats, at most the limit", (t) => {
  withStorage(t, memory());
  assert.deepEqual(recentRepos(), []);
  for (let i = 0; i < RECENT_LIMIT + 3; i++) rememberRepo(`r${i}`);
  rememberRepo("r5");
  const list = recentRepos();
  assert.equal(list.length, RECENT_LIMIT);
  assert.equal(list[0], "r5");
  assert.equal(list.filter((r) => r === "r5").length, 1);
});

test("the picker remembers its folder", (t) => {
  withStorage(t, memory());
  assert.equal(lastPickerPath(), "");
  rememberPickerPath("code/payments-api");
  assert.equal(lastPickerPath(), "code/payments-api");
});

test("a storage that throws, or holds junk, reads as empty and never throws", (t) => {
  withStorage(t, {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  });
  assert.deepEqual(recentRepos(), []);
  assert.equal(lastPickerPath(), "");
  rememberRepo("x");
  rememberPickerPath("x");
});

test("junk under the key reads as no repos", (t) => {
  const store = memory();
  withStorage(t, store);
  store.items.set("ordo.recentRepos", "{not json");
  assert.deepEqual(recentRepos(), []);
  store.items.set("ordo.recentRepos", JSON.stringify(["a", 3, null, "b"]));
  assert.deepEqual(recentRepos(), ["a", "b"]);
});
