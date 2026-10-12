// CONFIG: the defaults when it is missing or blank, each switch it sets, and
// a refusal, with a message, for anything else.
import { test } from "node:test";
import assert from "node:assert/strict";

import { readConfig } from "../config.ts";

test("no CONFIG, or a blank one, is all defaults", () => {
  assert.deepEqual(readConfig({}), { miniMap: true });
  assert.deepEqual(readConfig({ CONFIG: "" }), { miniMap: true });
  assert.deepEqual(readConfig({ CONFIG: "  " }), { miniMap: true });
  assert.deepEqual(readConfig({ CONFIG: "{}" }), { miniMap: true });
});

test("MINI_MAP turns the minimap off and on", () => {
  assert.deepEqual(readConfig({ CONFIG: '{"MINI_MAP": false}' }), { miniMap: false });
  assert.deepEqual(readConfig({ CONFIG: '{"MINI_MAP": true}' }), { miniMap: true });
});

test("anything else stops the server, saying why", () => {
  assert.throws(() => readConfig({ CONFIG: "{MINI_MAP: false}" }), /not valid JSON/);
  assert.throws(() => readConfig({ CONFIG: "false" }), /must be a JSON object/);
  assert.throws(() => readConfig({ CONFIG: "[]" }), /must be a JSON object/);
  assert.throws(() => readConfig({ CONFIG: "null" }), /must be a JSON object/);
  assert.throws(() => readConfig({ CONFIG: '{"MINIMAP": false}' }), /no setting MINIMAP; it knows MINI_MAP/);
  assert.throws(() => readConfig({ CONFIG: '{"toString": false}' }), /no setting toString/);
  assert.throws(() => readConfig({ CONFIG: '{"MINI_MAP": "false"}' }), /MINI_MAP must be true or false, not "false"/);
  assert.throws(() => readConfig({ CONFIG: '{"MINI_MAP": 0}' }), /MINI_MAP must be true or false, not 0/);
});
