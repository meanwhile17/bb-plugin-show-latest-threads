import assert from "node:assert/strict";
import { test } from "node:test";
import { comparePinned, selectRecent, type SidebarThreadLike } from "../lib/recent.ts";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 7, 12);

function thread(id: string, hoursAgo: number, extra: Partial<SidebarThreadLike> = {}): SidebarThreadLike {
  const at = NOW - hoursAgo * HOUR;
  return {
    id,
    parentThreadId: null,
    status: "idle",
    indicator: "none",
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    hasPendingInteraction: false,
    updatedAt: at,
    latestAttentionAt: at,
    lastReadAt: null,
    pinSortKey: null,
    pinnedAt: null,
    ...extra,
  } as SidebarThreadLike;
}

test("keeps threads inside the window and drops older ones", () => {
  const keep = selectRecent([thread("a", 10), thread("b", 50)], NOW - 48 * HOUR, null);
  assert.deepEqual([...keep], ["a"]);
});

test("window boundary is inclusive and 72h keeps what 48h drops", () => {
  const list = [thread("edge", 48), thread("old", 60)];
  assert.deepEqual([...selectRecent(list, NOW - 48 * HOUR, null)], ["edge"]);
  assert.deepEqual([...selectRecent(list, NOW - 72 * HOUR, null)].sort(), ["edge", "old"]);
});

test("a recent child keeps its old parent so the tree stays intact", () => {
  const list = [thread("root", 200), thread("child", 1, { parentThreadId: "root" })];
  assert.deepEqual([...selectRecent(list, NOW - 24 * HOUR, null)].sort(), ["child", "root"]);
});

test("old active, running and waiting threads stay visible", () => {
  const list = [
    thread("active", 300),
    thread("running", 300, { status: "active" }),
    thread("waiting", 300, { hasPendingInteraction: true }),
    thread("idle", 300),
  ];
  assert.deepEqual([...selectRecent(list, NOW - 24 * HOUR, "active")].sort(), ["active", "running", "waiting"]);
});

test("reading a thread counts as touching it", () => {
  const list = [thread("read", 100, { lastReadAt: NOW - HOUR })];
  assert.deepEqual([...selectRecent(list, NOW - 24 * HOUR, null)], ["read"]);
});

test("a parent cycle does not hang", () => {
  const list = [thread("x", 1, { parentThreadId: "y" }), thread("y", 100, { parentThreadId: "x" })];
  assert.deepEqual([...selectRecent(list, NOW - 24 * HOUR, null)].sort(), ["x", "y"]);
});

test("pinned order: manual keys first, then by pin time", () => {
  const list = [
    thread("late", 1, { pinnedAt: 30 }),
    thread("keyB", 1, { pinSortKey: "b" }),
    thread("early", 1, { pinnedAt: 10 }),
    thread("keyA", 1, { pinSortKey: "a" }),
  ];
  assert.deepEqual(list.sort(comparePinned).map((t) => t.id), ["keyA", "keyB", "early", "late"]);
});
