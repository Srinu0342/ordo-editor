// Diagram names: the rules a new tab's name must pass (each one, the
// case-insensitive clash, Windows device names with an extension), and the
// looser check that lets a deleted diagram's folder be recreated.
import { test } from "node:test";
import assert from "node:assert/strict";

import { checkDiagramName, isSafeSegment } from "../names.ts";

const reason = (name: string, existing: string[] = []) => checkDiagramName(name, existing)?.reason ?? null;

test("ordinary names pass", () => {
  for (const name of ["checkout", "auth flow", "v2.1", "A", "9", "data_model-v3", "x".repeat(64)])
    assert.equal(checkDiagramName(name, []), null, name);
});

test("a name must be 1 to 64 characters", () => {
  assert.equal(reason(""), "invalid");
  assert.equal(reason("x".repeat(65)), "invalid");
});

test("a name starts with a letter or a digit", () => {
  for (const name of [" checkout", ".hidden", "-x", "_x"]) assert.equal(reason(name), "invalid", name);
});

test("a name uses ASCII letters, digits, space, -, _ and . only", () => {
  for (const name of ["a/b", "a\\b", "a:b", "a*b", "café", "a\tb", "a\0b", "a\nb"])
    assert.equal(reason(name), "invalid", JSON.stringify(name));
});

test("a name can't end with a space or a dot", () => {
  assert.equal(reason("checkout "), "invalid");
  assert.equal(reason("checkout."), "invalid");
  assert.equal(reason("check out"), null);
  assert.equal(reason("check.out"), null);
});

test("Windows device names are refused, with or without an extension, in any case", () => {
  for (const name of ["con", "CON", "prn", "aux", "nul", "com1", "COM9", "lpt1", "Lpt9", "con.yaml", "nul.txt", "aux.a.b"])
    assert.equal(reason(name), "invalid", name);
  // Only the exact device names: these merely start like one.
  for (const name of ["console", "com0", "com10", "lpt", "nullable", "auxiliary"]) assert.equal(reason(name), null, name);
});

test("a name that matches an existing diagram, ignoring case, is taken", () => {
  assert.equal(reason("auth", ["auth"]), "taken");
  assert.equal(reason("Auth", ["auth", "checkout"]), "taken");
  assert.equal(reason("CHECKOUT", ["auth", "checkout"]), "taken");
  assert.equal(reason("auth2", ["auth"]), null);
});

test("the message is one sentence and names the clash as it is spelled on disk", () => {
  const problem = checkDiagramName("Auth", ["auth"]);
  assert.deepEqual(problem, { reason: "taken", message: 'There is already a diagram called "auth".' });
  for (const name of ["", "con", "a/b", "x."]) {
    const message = checkDiagramName(name, [])?.message ?? "";
    assert.match(message, /^[A-Z"].*\.$/, name);
  }
});

test("an invalid name is reported as invalid even when it would also clash", () => {
  assert.equal(reason("con", ["con"]), "invalid");
});

test("isSafeSegment: one folder name, nothing that climbs or splits", () => {
  for (const name of ["checkout", "auth flow", "café", ".hidden", "con", "a..b", "x".repeat(255)])
    assert.equal(isSafeSegment(name), true, name);
  for (const name of ["", ".", "..", "a/b", "/", "a\\b", "a\0b", "x".repeat(256)])
    assert.equal(isSafeSegment(name), false, JSON.stringify(name));
});

test("isSafeSegment counts bytes, not characters", () => {
  // "é" is two bytes in UTF-8: 127 of them is 254 bytes, 128 is 256.
  assert.equal(isSafeSegment("é".repeat(127)), true);
  assert.equal(isSafeSegment("é".repeat(128)), false);
});
