// bb-plugin-show-latest-threads - backend entry.
//
// Declares the plugin settings (language, recent-only filter and its
// window) and one RPC method the sidebar list calls when the user flips the
// filter or picks 24/48/72 hours in the list itself. Settings stay the single
// store, so the Settings page and every open window agree.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const LANGUAGE_OPTIONS = ["System", "English", "Русский"];
export const WINDOW_OPTIONS = ["24 hours", "48 hours", "72 hours"];

export const rpcContract = defineRpcContract({
  set_view: {
    input: z
      .object({
        recentOnly: z.boolean().optional(),
        windowHours: z.union([z.literal(24), z.literal(48), z.literal(72)]).optional(),
      })
      .strict(),
    output: z.object({ ok: z.literal(true) }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    recentOnly: {
      type: "boolean",
      label: "Show only recent threads / Только недавние треды",
      description:
        "Hide threads and projects with no activity inside the window below. Also switchable at the top of the list.",
      default: true,
    },
    window: {
      type: "select",
      label: "Activity window / Окно активности",
      options: WINDOW_OPTIONS,
      default: "48 hours",
    },
    language: {
      type: "select",
      label: "Language / Язык",
      description: "System follows your computer's language; anything other than Russian shows English.",
      options: LANGUAGE_OPTIONS,
      default: "System",
    },
  });

  bb.rpc.register(rpcContract, {
    set_view: async ({ recentOnly, windowHours }) => {
      await settings.experimental_set({
        ...(recentOnly === undefined ? {} : { recentOnly }),
        ...(windowHours === undefined ? {} : { window: `${windowHours} hours` }),
      });
      return { ok: true as const };
    },
  });

  bb.log.info("loaded");
  bb.onDispose(() => bb.log.info("disposed"));
}
