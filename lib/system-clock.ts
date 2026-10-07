// Server side: the clock settings of the computer BB runs on. A browser only
// sees its language list; macOS keeps the region (en_RU) and the "24-hour
// time" switch in global preferences, which a page cannot read.
import { execFile } from "node:child_process";

export interface SystemClock {
  /** BCP 47 tag with region when known, e.g. "en-RU". */
  locale: string | null;
  /** true/false when the user forced a 12/24-hour clock, null otherwise. */
  hour12: boolean | null;
}

const CACHE_MS = 5 * 60_000;
let cached: { at: number; value: SystemClock } | null = null;

function readGlobalDefault(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("/usr/bin/defaults", ["read", "-g", key], { timeout: 2000 }, (error, stdout) =>
      resolve(error ? null : String(stdout).trim() || null),
    );
  });
}

export function toTag(posix: string | null | undefined): string | null {
  if (!posix) return null;
  const base = posix.split(/[.@]/)[0]?.replace(/_/g, "-") ?? "";
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(base) || base === "C" || base === "POSIX") return null;
  return base;
}

export async function readSystemClock(): Promise<SystemClock> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  let value: SystemClock;
  if (process.platform === "darwin") {
    const [locale, force24, force12] = await Promise.all([
      readGlobalDefault("AppleLocale"),
      readGlobalDefault("AppleICUForce24HourTime"),
      readGlobalDefault("AppleICUForce12HourTime"),
    ]);
    value = {
      locale: toTag(locale),
      hour12: force24 === "1" ? false : force12 === "1" ? true : null,
    };
  } else {
    const env = process.env;
    value = { locale: toTag(env.LC_ALL || env.LC_TIME || env.LANG), hour12: null };
  }
  cached = { at: Date.now(), value };
  return value;
}
