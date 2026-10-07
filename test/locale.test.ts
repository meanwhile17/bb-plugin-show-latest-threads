import assert from "node:assert/strict";
import { test } from "node:test";
import { dateLocale, makeTimeFormat, resolveHour12, resolveLang } from "../lib/locale.ts";

function withLanguages(languages: string[], run: () => void) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: { languages, language: languages[0] },
    configurable: true,
  });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
  }
}

test("explicit language wins over the system", () => {
  withLanguages(["ru-RU"], () => assert.equal(resolveLang("English"), "en"));
  withLanguages(["en-US"], () => assert.equal(resolveLang("Русский"), "ru"));
});

test("System language: Russian only for ru, English for everything else", () => {
  withLanguages(["ru-KZ"], () => assert.equal(resolveLang("System"), "ru"));
  withLanguages(["de-DE"], () => assert.equal(resolveLang("System"), "en"));
  withLanguages(["vi-VN"], () => assert.equal(resolveLang(undefined), "en"));
});

test("System clock follows the region, not the language", () => {
  withLanguages(["en-US"], () => assert.equal(resolveHour12("System", "en"), true));
  withLanguages(["en-RU"], () => assert.equal(resolveHour12("System", "en"), false));
  withLanguages(["en-GB"], () => assert.equal(resolveHour12("System", "en"), false));
  withLanguages(["en-PH"], () => assert.equal(resolveHour12("System", "en"), true));
  withLanguages(["ru-RU"], () => assert.equal(resolveHour12("System", "ru"), false));
});

test("explicit clock wins", () => {
  withLanguages(["en-US"], () => assert.equal(resolveHour12("24-hour (14:30)", "en"), false));
  withLanguages(["ru-RU"], () => assert.equal(resolveHour12("12-hour (2:30 PM)", "ru"), true));
});

test("formatted times", () => {
  const at = new Date(2026, 9, 7, 14, 5);
  withLanguages(["en-US"], () => {
    assert.match(makeTimeFormat("en", true).format(at), /^2:05\s?PM$/);
    assert.equal(makeTimeFormat("en", false).format(at), "14:05");
  });
  withLanguages(["ru-RU"], () => {
    assert.equal(makeTimeFormat("ru", false).format(at), "14:05");
    assert.match(makeTimeFormat("ru", true).format(at), /^2:05\s?PM$/i);
  });
});

test("English date order follows the user's English variant", () => {
  withLanguages(["en-GB"], () => assert.equal(dateLocale("en"), "en-GB"));
  withLanguages(["de-DE"], () => assert.equal(dateLocale("en"), "en-US"));
  withLanguages(["en-US"], () => assert.equal(dateLocale("ru"), "ru-RU"));
});

test("the computer's own clock switch beats the region", () => {
  withLanguages(["en-US"], () => assert.equal(resolveHour12("System", "en", { locale: "en-US", hour12: false }), false));
  withLanguages(["ru-RU"], () => assert.equal(resolveHour12("System", "ru", { locale: "ru-RU", hour12: true }), true));
});

test("the computer's region beats a region-less browser language", () => {
  withLanguages(["en"], () => assert.equal(resolveHour12("System", "en", { locale: "en-RU", hour12: null }), false));
  withLanguages(["de"], () => assert.equal(resolveHour12("System", "en", { locale: "de-DE", hour12: null }), false));
  withLanguages(["en"], () => assert.equal(resolveHour12("System", "en", { locale: "en-US", hour12: null }), true));
});

test("an explicit setting still wins over the computer", () => {
  withLanguages(["en-US"], () => assert.equal(resolveHour12("12-hour (2:30 PM)", "en", { locale: "en-RU", hour12: false }), true));
});
