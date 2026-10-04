// What ships must not carry the test scaffolding: no jsdom, no getBBox shim,
// no reach into Mermaid's renderer internals. Checked over every source module
// that is not itself a test, so it holds for whatever the bundler pulls in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../", import.meta.url));

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sources(path);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) ? [path] : [];
  });

// Code, not prose: a comment saying "no jsdom" is the point, not a breach.
const imports = (what: string) =>
  new RegExp(`(from\\s*|import\\s*\\(\\s*|require\\s*\\(\\s*)["'][^"']*${what}`);

const FORBIDDEN: [pattern: RegExp, what: string][] = [
  [imports("jsdom"), "an import of jsdom"],
  [/getBBox\s*=/, "a getBBox shim"],
  [/\brenderer\s*\.\s*bounds\b/, "renderer.bounds"],
  [imports("__tests__"), "an import from __tests__"],
];

test("no production module touches the test-only scaffolding", () => {
  const files = sources(SRC);
  assert.ok(files.length > 20);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const [pattern, what] of FORBIDDEN)
      assert.ok(!pattern.test(text), `${relative(SRC, file)} mentions ${what}`);
  }
});
