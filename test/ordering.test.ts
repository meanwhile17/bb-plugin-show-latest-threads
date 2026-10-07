import assert from "node:assert/strict";
import { test } from "node:test";
import { compareGroups } from "../lib/ordering.ts";

function order(names: string[]): string[] {
  return names.map((name) => ({ key: `project:${name}`, name })).sort(compareGroups).map((g) => g.name);
}

test("numbered projects ascend naturally, including multi-part numbers", () => {
  assert.deepEqual(
    order(["1.9 Sales", "6. Personal", "1.10 Meetings", "1. Voctiv", "6.2 Vault", "1.12 Docs", "6.1 Family"]),
    ["1. Voctiv", "1.9 Sales", "1.10 Meetings", "1.12 Docs", "6. Personal", "6.1 Family", "6.2 Vault"],
  );
});

test("English and Russian names ascend and embedded integers use numeric order", () => {
  assert.deepEqual(order(["Alpha", "Zoo", "Beta"]), ["Alpha", "Beta", "Zoo"]);
  assert.deepEqual(order(["Альфа", "Яндекс", "Бета"]), ["Альфа", "Бета", "Яндекс"]);
  assert.deepEqual(order(["Topic 2", "Topic 10", "Topic 1"]), ["Topic 1", "Topic 2", "Topic 10"]);
});

test("sections stay ahead of projects; activity does not reorder either", () => {
  const groups = [
    { key: "project:p1", name: "1. Voctiv", latest: 999 },
    { key: "section:s1", name: "Cash flow", latest: 1 },
    { key: "project:p2", name: "6. Family", latest: 0 },
    { key: "section:s2", name: "Tax audit", latest: 0 },
  ];
  const expected = ["section:s1", "section:s2", "project:p1", "project:p2"];
  assert.deepEqual([...groups].sort(compareGroups).map((g) => g.key), expected);
  groups.forEach((g) => { g.latest = 1000 - g.latest; });
  assert.deepEqual([...groups].sort(compareGroups).map((g) => g.key), expected);
});

test("equal names use a stable identity independent of incoming cache order", () => {
  const groups = [{ key: "project:b", name: "Same" }, { key: "project:a", name: "same" }];
  assert.deepEqual([...groups].sort(compareGroups).map((g) => g.key), ["project:a", "project:b"]);
  assert.deepEqual([...groups].reverse().sort(compareGroups).map((g) => g.key), ["project:a", "project:b"]);
});
