---
name: show-latest-threads
description: "Settings of the Show Latest Threads sidebar list: recent-only filter, 24/48/72-hour window and language."
---

# Show Latest Threads

The plugin replaces the sidebar thread list. At the top of the list the user
switches "Recent only" and picks a 24, 48 or 72 hour window. Hidden threads
are still there; they only leave the list.

Each row shows its status on the right, like BB's own list: a dot for
unread, a spinner while the agent works, a question mark when it waits for
an answer, a red cross after a failure, a clock for a queued message, and a
pencil for an unsent draft.

Change the same settings from a shell:

```sh
bb plugin config show-latest-threads set recentOnly true
bb plugin config show-latest-threads set window "72 hours"
bb plugin config show-latest-threads set language "English"
```

Values: `window` is `24 hours`, `48 hours` or `72 hours`; `language` is
`System`, `English` or `Русский`.

If the list does not appear, select it under Settings > Appearance > Sidebar.
