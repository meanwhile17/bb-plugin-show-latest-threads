import assert from "node:assert/strict";
import { test } from "node:test";
import { readSystemClock, toTag } from "../lib/system-clock.ts";

test("POSIX and macOS locale names become BCP 47 tags", () => {
  assert.equal(toTag("en_RU"), "en-RU");
  assert.equal(toTag("de_DE.UTF-8"), "de-DE");
  assert.equal(toTag("sr_RS@latin"), "sr-RS");
  assert.equal(toTag("C"), null);
  assert.equal(toTag("POSIX"), null);
  assert.equal(toTag(""), null);
  assert.equal(toTag(undefined), null);
});

test("reads this computer without throwing", async () => {
  const clock = await readSystemClock();
  assert.ok(clock.locale === null || typeof clock.locale === "string");
  assert.ok(clock.hour12 === null || typeof clock.hour12 === "boolean");
});
