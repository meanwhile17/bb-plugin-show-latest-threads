---
name: show-latest-threads
description: "Settings of the Show Latest Threads sidebar list: recent-only filter, 24/48/72-hour window, language and clock."
---

# Show Latest Threads

The plugin replaces the sidebar thread list. At the top of the list the user
switches "Recent only" and picks a 24, 48 or 72 hour window. Hidden threads
are still there; they only leave the list.

Change the same settings from a shell:

```sh
bb plugin config show-latest-threads set recentOnly true
bb plugin config show-latest-threads set window "72 hours"
bb plugin config show-latest-threads set language "English"
bb plugin config show-latest-threads set timeFormat "24-hour (14:30)"
```

Values: `window` is `24 hours`, `48 hours` or `72 hours`; `language` is
`System`, `English` or `Русский`; `timeFormat` is `System`,
`12-hour (2:30 PM)` or `24-hour (14:30)`.

If the list does not appear, select it under Settings > Appearance > Sidebar.
