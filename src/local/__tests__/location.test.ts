// The address bar as the only record of where the editor is: every place it
// can name reads back as itself, whatever the names hold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { placeUrl, readPlace } from "../location.ts";
import type { Place } from "../location.ts";

const search = (url: string) => new URL(url, "http://localhost").search;

test("no query, or anything but source=local with a repo, is no repo", () => {
  for (const s of ["", "?", "?repo=code/x", "?source=free&repo=code/x", "?source=local", "?source=LOCAL&repo=x"])
    assert.deepEqual(readPlace(s), { source: "free" }, s);
});

test("a repo with no tab, or an empty tab, opens the repo's first diagram", () => {
  assert.deepEqual(readPlace("?source=local&repo=code/x"), { source: "local", repo: "code/x", tab: null });
  assert.deepEqual(readPlace("?source=local&repo=code/x&tab="), { source: "local", repo: "code/x", tab: null });
});

test("the URL keeps a repo's slashes readable and encodes the rest", () => {
  assert.equal(placeUrl({ source: "free" }), "/");
  assert.equal(
    placeUrl({ source: "local", repo: "code/payments-api", tab: "auth flow" }),
    "/?source=local&repo=code/payments-api&tab=auth%20flow",
  );
  assert.equal(placeUrl({ source: "local", repo: "code/x", tab: null }), "/?source=local&repo=code/x");
});

test("every place reads back as itself, whatever its names hold", () => {
  const names = ["plain", "with space", "a/b/c", "100%", "C#", "a+b", "a&b=c", "ünïcødé/日本", "?x", ""];
  for (const repo of names)
    for (const tab of [null, ...names.filter(Boolean)]) {
      const place: Place = { source: "local", repo, tab };
      assert.deepEqual(readPlace(search(placeUrl(place))), place, JSON.stringify(place));
    }
});
