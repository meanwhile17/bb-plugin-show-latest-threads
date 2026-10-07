// Language and clock resolution shared by the plugin's frontend.
//
// Settings store human-readable option strings (BB renders select options
// verbatim), so this module maps them to a language and a 12/24-hour clock.
// "System" follows the user's machine: the language from the browser's
// preferred languages, the clock from the computer's own 12/24-hour switch,
// else from the REGION (en-RU uses 24 hours, en-US uses 12), not the language.
// The server supplies the computer's settings (see system-clock.ts).

export type Lang = "en" | "ru";

export const LANGUAGE_OPTIONS = ["System", "English", "Русский"];
export const TIME_FORMAT_OPTIONS = ["System", "12-hour (2:30 PM)", "24-hour (14:30)"];

function preferredTags(): string[] {
  const tags: string[] = [];
  if (typeof navigator !== "undefined") {
    if (Array.isArray(navigator.languages)) tags.push(...navigator.languages);
    if (navigator.language) tags.push(navigator.language);
  }
  try {
    tags.push(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    // Intl unavailable: fall through to the defaults below.
  }
  return tags.filter((tag) => typeof tag === "string" && tag.length > 0);
}

export function resolveLang(setting: unknown): Lang {
  if (setting === "English") return "en";
  if (setting === "Русский") return "ru";
  const first = preferredTags()[0] ?? "en";
  return first.toLowerCase().startsWith("ru") ? "ru" : "en";
}

type LocaleWithCycles = Intl.Locale & {
  getHourCycles?: () => string[];
  hourCycles?: string[];
};

export interface SystemClockHint {
  locale: string | null;
  hour12: boolean | null;
}

function regionUses12Hours(extraTags: string[]): boolean | null {
  for (const tag of [...extraTags, ...preferredTags()]) {
    try {
      const locale = new Intl.Locale(tag) as LocaleWithCycles;
      if (!locale.region) continue;
      const cycles = locale.getHourCycles?.() ?? locale.hourCycles;
      if (Array.isArray(cycles) && cycles.length > 0) {
        return cycles[0] === "h12" || cycles[0] === "h11";
      }
    } catch {
      // Malformed tag: try the next one.
    }
  }
  return null;
}

export function resolveHour12(setting: unknown, lang: Lang, system?: SystemClockHint | null): boolean {
  if (typeof setting === "string") {
    if (setting.startsWith("12")) return true;
    if (setting.startsWith("24")) return false;
  }
  if (typeof system?.hour12 === "boolean") return system.hour12;
  const byRegion = regionUses12Hours(system?.locale ? [system.locale] : []);
  if (byRegion !== null) return byRegion;
  try {
    const cycle = new Intl.DateTimeFormat(dateLocale(lang), { hour: "numeric" }).resolvedOptions().hourCycle;
    return cycle === "h12" || cycle === "h11";
  } catch {
    return lang === "en";
  }
}

/** Locale for dates: Russian, or the user's own English variant (en-GB keeps "3 Oct"). */
export function dateLocale(lang: Lang): string {
  if (lang === "ru") return "ru-RU";
  const english = preferredTags().find((tag) => tag.toLowerCase().startsWith("en"));
  if (english) {
    try {
      return Intl.DateTimeFormat.supportedLocalesOf([english])[0] ?? "en-US";
    } catch {
      return "en-US";
    }
  }
  return "en-US";
}

export function makeTimeFormat(lang: Lang, hour12: boolean): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(dateLocale(lang), {
    hour: hour12 ? "numeric" : "2-digit",
    minute: "2-digit",
    hour12,
  });
}
