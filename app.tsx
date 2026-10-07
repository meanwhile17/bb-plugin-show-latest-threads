// bb-plugin-show-latest-threads - frontend entry.
//
// A sidebar thread list (the exclusive `experimental_threadList` slot) that
// can hide everything with no activity inside a 24, 48 or 72 hour window.
// Pinned threads come first, then named sections, then projects ordered by
// name ascending, with natural numeric ordering. A kept child keeps its parents, so the tree
// never breaks. The active thread and threads that are running or waiting
// for an answer stay visible whatever their age.
//
// The list reads the same live cache as BB's own list
// (`experimental_useSidebarThreads`) and acts through the host's actions, so
// archive and delete go through BB's own confirmations.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  ThreadTitle,
  definePluginApp,
  experimental_Icon as Icon,
  experimental_usePluginId,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreadSplit,
  experimental_useSidebarThreads,
  useRpc,
  useSettings,
  useSidebarThreadDraft,
} from "@get-bb/plugin-sdk/app";
import type {
  PluginSidebarProject,
  PluginSidebarThread,
  PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { resolveLang, type Lang } from "./lib/locale";
import { compareGroups } from "./lib/ordering";
import {
  compareThreads,
  comparePinned,
  isBusy,
  needsUser,
  selectRecent,
} from "./lib/recent";

const HOUR_MS = 3_600_000;
const TICK_MS = 60_000;
const MAX_DEPTH = 6;
const WINDOWS = [24, 48, 72] as const;
type WindowHours = (typeof WINDOWS)[number];

const STRINGS = {
  en: {
    recentOnly: "Recent only",
    hours: (n: number) => `${n}h`,
    windowLabel: (n: number) => `Show threads active in the last ${n} hours`,
    pinned: "Pinned",
    personal: "Personal",
    empty: (n: number) => `No threads in the last ${n} hours.`,
    showAll: "Show all",
    error: "Threads are unavailable right now.",
    loading: "Loading threads",
    pin: "Pin",
    unpin: "Unpin",
    markRead: "Mark as read",
    markUnread: "Mark as unread",
    rename: "Rename",
    archive: "Archive",
    remove: "Delete…",
    newThread: (name: string) => `New thread in ${name}`,
    actionsFor: (title: string) => `Actions for ${title}`,
    expand: (name: string) => `Expand ${name}`,
    collapse: (name: string) => `Collapse ${name}`,
    draft: "Unsent draft",
  },
  ru: {
    recentOnly: "Только недавние",
    hours: (n: number) => `${n} ч`,
    windowLabel: (n: number) => `Показать треды с активностью за последние ${n} ч`,
    pinned: "Закреплённые",
    personal: "Личное",
    empty: (n: number) => `За последние ${n} ч тредов нет.`,
    showAll: "Показать все",
    error: "Треды сейчас недоступны.",
    loading: "Загрузка тредов",
    pin: "Закрепить",
    unpin: "Открепить",
    markRead: "Отметить прочитанным",
    markUnread: "Отметить непрочитанным",
    rename: "Переименовать",
    archive: "В архив",
    remove: "Удалить…",
    newThread: (name: string) => `Новый тред в ${name}`,
    actionsFor: (title: string) => `Действия: ${title}`,
    expand: (name: string) => `Развернуть ${name}`,
    collapse: (name: string) => `Свернуть ${name}`,
    draft: "Неотправленный черновик",
  },
} as const;
type Strings = (typeof STRINGS)[Lang];

function parseWindow(value: unknown): WindowHours {
  const hours = Number.parseInt(String(value ?? ""), 10);
  return hours === 24 || hours === 72 ? hours : 48;
}

/* Collapsed state, kept in this browser's localStorage under the plugin id - */

function useCollapsed(storageKey: string) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []);
    } catch {
      return new Set();
    }
  });
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        // Storage unavailable: collapsing still works until reload.
      }
      return next;
    });
  return { collapsed, toggle };
}

/* The list ---------------------------------------------------------------- */

interface Group {
  key: string;
  name: string;
  project: PluginSidebarProject | null;
  threads: PluginSidebarThread[];
}

interface RowContext {
  t: Strings;
  activeThreadId: string | null;
  isCompactViewport: boolean;
  onNavigate: () => void;
  collapsed: ReadonlySet<string>;
  toggleCollapsed: (id: string) => void;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  menuId: string | null;
  setMenuId: (id: string | null) => void;
}

function LatestThreadsList(props: PluginThreadListProps) {
  const { status, threads, projects, sections } = experimental_useSidebarThreads();
  const { values } = useSettings();
  const rpc = useRpc<typeof rpcContract>();
  const pluginId = experimental_usePluginId();
  const { collapsed, toggle } = useCollapsed(`${pluginId}.collapsed`);

  const lang = resolveLang(values?.language);
  const t = STRINGS[lang];
  // Optimistic view state: the setting round-trip must not lag the click.
  const [pending, setPending] = useState<{ recentOnly?: boolean; windowHours?: WindowHours }>({});
  const recentOnly = pending.recentOnly ?? values?.recentOnly !== false;
  const windowHours = pending.windowHours ?? parseWindow(values?.window);
  // Drop an optimistic value only once the stored setting has caught up with
  // it, so a slow reply to an earlier click cannot undo a later one.
  useEffect(() => {
    setPending((current) => {
      const next = { ...current };
      if (next.recentOnly !== undefined && next.recentOnly === (values?.recentOnly !== false)) {
        delete next.recentOnly;
      }
      if (next.windowHours !== undefined && next.windowHours === parseWindow(values?.window)) {
        delete next.windowHours;
      }
      return next;
    });
  }, [values?.recentOnly, values?.window]);
  const saveView = (next: { recentOnly?: boolean; windowHours?: WindowHours }) => {
    const changed: { recentOnly?: boolean; windowHours?: WindowHours } = {};
    if (next.recentOnly !== undefined && next.recentOnly !== recentOnly) changed.recentOnly = next.recentOnly;
    if (next.windowHours !== undefined && next.windowHours !== windowHours) changed.windowHours = next.windowHours;
    if (Object.keys(changed).length === 0) return;
    setPending((current) => ({ ...current, ...changed }));
    // When the call settles, drop exactly the values it carried unless a
    // later click has replaced them; the stored setting is the truth again.
    const settle = () =>
      setPending((current) => {
        const rest = { ...current };
        if (rest.recentOnly === changed.recentOnly) delete rest.recentOnly;
        if (rest.windowHours === changed.windowHours) delete rest.windowHours;
        return rest;
      });
    rpc.call("set_view", changed).then(settle, settle);
  };

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  const { pinned, groups, totalVisible } = useMemo(() => {
    const visible = threads.filter((thread) => !thread.isHidden && !thread.isArchived);
    const keep = recentOnly
      ? selectRecent(visible, now - windowHours * HOUR_MS, props.activeThreadId)
      : new Set(visible.map((thread) => thread.id));
    const shown = visible.filter((thread) => keep.has(thread.id));

    const pinnedThreads = shown.filter((thread) => thread.isPinned).sort(comparePinned);
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const sectionById = new Map(sections.map((section) => [section.id, section]));
    const byKey = new Map<string, Group>();
    for (const thread of shown) {
      if (thread.isPinned) continue;
      const section = thread.sectionId ? sectionById.get(thread.sectionId) : undefined;
      const project = projectById.get(thread.projectId) ?? null;
      const key = section ? `section:${section.id}` : `project:${thread.projectId}`;
      let group = byKey.get(key);
      if (!group) {
        group = {
          key,
          name: section ? section.name : project?.isPersonal ? t.personal : (project?.name ?? "-"),
          project: section ? null : project,
          threads: [],
        };
        byKey.set(key, group);
      }
      group.threads.push(thread);
    }
    // With the filter off, every project is listed, even one without threads,
    // so its "+ new thread" button stays reachable.
    if (!recentOnly) {
      for (const project of projects) {
        const key = `project:${project.id}`;
        if (byKey.has(key)) continue;
        byKey.set(key, {
          key,
          name: project.isPersonal ? t.personal : project.name,
          project,
          threads: [],
        });
      }
    }
    const ordered = [...byKey.values()].sort(compareGroups);
    return { pinned: pinnedThreads, groups: ordered, totalVisible: shown.length };
  }, [threads, projects, sections, recentOnly, windowHours, now, props.activeThreadId, t]);

  if (status === "loading") {
    return (
      <div className="space-y-2 p-2" role="status" aria-label={t.loading}>
        <div className="h-4 w-3/4 rounded-sm bg-sidebar-border/50" />
        <div className="h-4 w-2/3 rounded-sm bg-sidebar-border/50" />
        <div className="h-4 w-1/2 rounded-sm bg-sidebar-border/50" />
      </div>
    );
  }
  if (status === "error") {
    return <div className="p-3 text-xs text-muted-foreground">{t.error}</div>;
  }

  const ctx: RowContext = {
    t,
    activeThreadId: props.activeThreadId,
    isCompactViewport: props.isCompactViewport,
    onNavigate: props.onNavigate,
    collapsed,
    toggleCollapsed: toggle,
    renamingId,
    setRenamingId,
    menuId,
    setMenuId,
  };

  return (
    <div className="pb-2">
      <ViewControls
        t={t}
        recentOnly={recentOnly}
        windowHours={windowHours}
        onRecentOnly={(next) => saveView({ recentOnly: next })}
        onWindow={(next) => saveView({ windowHours: next, recentOnly: true })}
      />

      {pinned.length > 0 ? (
        <section className="space-y-px py-1" aria-label={t.pinned}>
          <div className="px-2 pb-0.5 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
            {t.pinned}
          </div>
          <ThreadTree threads={pinned} ctx={ctx} />
        </section>
      ) : null}

      {groups.map((group) => (
        <GroupBlock key={group.key} group={group} ctx={ctx} />
      ))}

      {totalVisible === 0 ? (
        <div className="space-y-2 px-2 py-3 text-xs text-muted-foreground">
          <div>{recentOnly ? t.empty(windowHours) : "—"}</div>
          {recentOnly ? (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-foreground hover:bg-sidebar-accent"
              onClick={() => saveView({ recentOnly: false })}
            >
              {t.showAll}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ViewControls({
  t,
  recentOnly,
  windowHours,
  onRecentOnly,
  onWindow,
}: {
  t: Strings;
  recentOnly: boolean;
  windowHours: WindowHours;
  onRecentOnly: (next: boolean) => void;
  onWindow: (next: WindowHours) => void;
}) {
  return (
    <div className="mb-1 flex items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground">
      <button
        type="button"
        role="switch"
        aria-checked={recentOnly}
        onClick={() => onRecentOnly(!recentOnly)}
        className="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 hover:bg-sidebar-accent"
      >
        <span
          aria-hidden="true"
          className={`relative inline-block h-3.5 w-6 shrink-0 rounded-full transition-colors ${
            recentOnly ? "bg-primary" : "bg-muted-foreground/35"
          }`}
        >
          <span
            className="absolute top-0.5 size-2.5 rounded-full bg-background transition-all"
            style={{ left: recentOnly ? 12 : 2 }}
          />
        </span>
        <span className="truncate">{t.recentOnly}</span>
      </button>
      <div role="group" className="ml-auto flex shrink-0 overflow-hidden rounded-md border border-sidebar-border">
        {WINDOWS.map((hours) => {
          const selected = recentOnly && hours === windowHours;
          return (
            <button
              key={hours}
              type="button"
              aria-pressed={selected}
              title={t.windowLabel(hours)}
              onClick={() => onWindow(hours)}
              className={`px-1.5 py-0.5 tabular-nums ${
                selected ? "bg-sidebar-accent text-foreground" : "hover:bg-sidebar-accent/60"
              }`}
            >
              {t.hours(hours)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GroupBlock({ group, ctx }: { group: Group; ctx: RowContext }) {
  const actions = experimental_useSidebarThreadActions();
  const isCollapsed = ctx.collapsed.has(group.key);
  return (
    <section className="group/project py-0.5" aria-label={group.name}>
      <div className="flex min-w-0 items-center gap-1 rounded-md px-1 py-1 text-sm text-foreground hover:bg-sidebar-accent/50">
        <button
          type="button"
          onClick={() => ctx.toggleCollapsed(group.key)}
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? ctx.t.expand(group.name) : ctx.t.collapse(group.name)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <span
            aria-hidden="true"
            className={`inline-block w-3 shrink-0 text-center text-[10px] leading-none text-muted-foreground transition-transform ${
              isCollapsed ? "" : "rotate-90"
            }`}
          >
            ▸
          </span>
          <span className="min-w-0 truncate font-medium" title={group.name}>
            {group.name}
          </span>
          <span className="shrink-0 text-xs font-normal text-muted-foreground/70">
            {group.threads.length}
          </span>
        </button>
        {group.project && !ctx.isCompactViewport ? (
          <button
            type="button"
            onClick={() => actions.openNewThread({ projectId: group.project!.id, focusPrompt: true })}
            aria-label={ctx.t.newThread(group.name)}
            title={ctx.t.newThread(group.name)}
            className="rounded px-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/project:opacity-100"
          >
            +
          </button>
        ) : null}
      </div>
      {!isCollapsed ? (
        <div className="mb-1 ml-5 border-l border-sidebar-border pl-3">
          <ThreadTree threads={group.threads} ctx={ctx} />
        </div>
      ) : null}
    </section>
  );
}

function ThreadTree({ threads, ctx }: { threads: PluginSidebarThread[]; ctx: RowContext }) {
  const { roots, children } = useMemo(() => {
    const ids = new Set(threads.map((thread) => thread.id));
    const kids = new Map<string, PluginSidebarThread[]>();
    const top: PluginSidebarThread[] = [];
    for (const thread of threads) {
      const parent = thread.parentThreadId;
      if (parent && ids.has(parent)) {
        const list = kids.get(parent) ?? [];
        list.push(thread);
        kids.set(parent, list);
      } else {
        top.push(thread);
      }
    }
    for (const list of kids.values()) list.sort(compareThreads);
    if (!threads.some((thread) => thread.isPinned)) top.sort(compareThreads);
    return { roots: top, children: kids };
  }, [threads]);

  const render = (thread: PluginSidebarThread, depth: number) => {
    const kids = children.get(thread.id) ?? [];
    const expanded = !ctx.collapsed.has(`thread:${thread.id}`);
    return (
      <div key={thread.id}>
        <ThreadRow thread={thread} depth={depth} childCount={kids.length} expanded={expanded} ctx={ctx} />
        {expanded ? kids.map((kid) => render(kid, Math.min(depth + 1, MAX_DEPTH))) : null}
      </div>
    );
  };
  return <div className="space-y-px">{roots.map((thread) => render(thread, 0))}</div>;
}

// Glyphs follow BB's own list: a dot for unread, a spinner while the agent
// works, a question mark when it waits for you, a red cross after a failure.
const ACTIVITY_ICONS: Partial<Record<PluginSidebarThread["indicator"], string>> = {
  workflow: "Workflow",
  "background-agent": "UserRoundPlus",
  "background-command": "Terminal",
  "plan-mode": "ListTodo",
  goal: "Target",
};

function StatusGlyph({ thread, hasDraft, draftLabel }: { thread: PluginSidebarThread; hasDraft: boolean; draftLabel: string }) {
  const label = thread.indicatorLabel ?? undefined;
  let kind: string = thread.indicator;
  if (needsUser(thread) && kind !== "unread-error") kind = "waiting-for-input";
  if (hasDraft && (kind === "none" || kind === "unread-success")) kind = "draft";
  if (hasDraft && kind === "runtime") kind = "working-draft";
  if (kind === "none" && thread.isUnread) kind = "unread-success";
  const icon = "size-3.5 shrink-0";
  switch (kind) {
    case "unread-error":
    case "queued-failed":
      return <Icon name="CircleX" className={`${icon} text-destructive`} aria-label={label} />;
    case "waiting-for-input":
      return <Icon name="CircleQuestion" className={`${icon} text-muted-foreground`} aria-label={label} />;
    case "queued-waiting":
      return <Icon name="Clock" className={`${icon} text-muted-foreground/75`} aria-label={label} />;
    case "runtime":
    case "working-draft":
      return (
        <Icon
          name="Loading"
          className={`${icon} animate-spin text-muted-foreground/60 motion-reduce:animate-none`}
          aria-label={label}
        />
      );
    case "draft":
      return <Icon name="Pencil" fallback="Edit" className={`${icon} text-muted-foreground/60`} aria-label={draftLabel} />;
    case "unread-success":
      return <span aria-label={label ?? undefined} className="mx-1 size-[5px] shrink-0 rounded-full bg-muted-foreground/60" />;
    default: {
      const name = ACTIVITY_ICONS[thread.indicator];
      if (name) return <Icon name={name} className={`${icon} text-muted-foreground/60`} aria-label={label} />;
      // An indicator kind added in a later BB version: show it as working.
      return isBusy(thread) ? (
        <Icon name="Loading" className={`${icon} animate-spin text-muted-foreground/60`} aria-label={label} />
      ) : null;
    }
  }
}

function ThreadRow({
  thread,
  depth,
  childCount,
  expanded,
  ctx,
}: {
  thread: PluginSidebarThread;
  depth: number;
  childCount: number;
  expanded: boolean;
  ctx: RowContext;
}) {
  const actions = experimental_useSidebarThreadActions();
  const { splitProps } = experimental_useSidebarThreadSplit(thread.id);
  const { hasUnsubmittedDraft } = useSidebarThreadDraft(thread.id);
  const isActive = thread.id === ctx.activeThreadId;
  const isRenaming = ctx.renamingId === thread.id;
  const title = thread.displayTitle;
  const rowRef = useRef<HTMLDivElement>(null);

  const open = (event: ReactMouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    actions.open(thread.id);
    ctx.onNavigate();
  };

  return (
    <div
      ref={rowRef}
      className={`group/row relative rounded-md ${
        isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50"
      }`}
      onContextMenu={(event) => {
        event.preventDefault();
        ctx.setMenuId(thread.id);
      }}
    >
      {isRenaming ? (
        <RenameField thread={thread} depth={depth} onDone={() => ctx.setRenamingId(null)} />
      ) : (
        <a
          {...splitProps}
          href={thread.href}
          data-sidebar-thread-shortcut-target=""
          data-sidebar-thread-id={thread.id}
          onClick={open}
          aria-label={thread.indicatorLabel ? `${title} - ${thread.indicatorLabel}` : title}
          className={`flex min-w-0 items-center gap-2 rounded-md py-1 pr-2 text-sm ${
            thread.isUnread && !isActive ? "font-medium text-foreground" : "text-muted-foreground"
          }`}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {childCount > 0 ? (
            <span
              role="button"
              tabIndex={-1}
              aria-hidden="true"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                ctx.toggleCollapsed(`thread:${thread.id}`);
              }}
              className={`-ml-1 inline-block w-3 shrink-0 text-center text-[10px] leading-none transition-transform ${
                expanded ? "rotate-90" : ""
              }`}
            >
              ▸
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate">
            <ThreadTitle threadId={thread.id} />
          </span>
          <span className="flex w-4 shrink-0 items-center justify-center group-hover/row:invisible">
            <StatusGlyph thread={thread} hasDraft={hasUnsubmittedDraft} draftLabel={ctx.t.draft} />
          </span>
        </a>
      )}
      {!isRenaming ? (
        <button
          type="button"
          aria-label={ctx.t.actionsFor(title)}
          aria-haspopup="menu"
          data-row-menu-trigger={thread.id}
          aria-expanded={ctx.menuId === thread.id}
          onClick={(event) => {
            event.stopPropagation();
            ctx.setMenuId(ctx.menuId === thread.id ? null : thread.id);
          }}
          className={`absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:opacity-100 ${
            ctx.isCompactViewport || ctx.menuId === thread.id ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"
          }`}
        >
          <span aria-hidden="true">⋯</span>
        </button>
      ) : null}
      {ctx.menuId === thread.id ? (
        <RowMenu thread={thread} ctx={ctx} anchor={rowRef.current?.getBoundingClientRect() ?? null} />
      ) : null}
    </div>
  );
}

function RenameField({
  thread,
  depth,
  onDone,
}: {
  thread: PluginSidebarThread;
  depth: number;
  onDone: () => void;
}) {
  const actions = experimental_useSidebarThreadActions();
  const [value, setValue] = useState(thread.title ?? thread.displayTitle);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    const next = value.trim();
    if (next && next !== thread.title) void actions.rename(thread.id, next);
    onDone();
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commit();
    if (event.key === "Escape") {
      done.current = true;
      onDone();
    }
  };
  return (
    <div className="py-0.5 pr-1" style={{ paddingLeft: 4 + depth * 14 }}>
      <input
        ref={ref}
        value={value}
        maxLength={200}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        className="w-full rounded border border-sidebar-border bg-background px-1.5 py-0.5 text-sm text-foreground outline-none"
      />
    </div>
  );
}

const MENU_WIDTH = 184;
const MENU_HEIGHT = 190;

function RowMenu({
  thread,
  ctx,
  anchor,
}: {
  thread: PluginSidebarThread;
  ctx: RowContext;
  anchor: DOMRect | null;
}) {
  const actions = experimental_useSidebarThreadActions();
  const ref = useRef<HTMLDivElement>(null);
  const close = () => ctx.setMenuId(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (ref.current?.contains(target)) return;
      // The row's own "..." button toggles the menu itself.
      if (target?.closest?.(`[data-row-menu-trigger="${thread.id}"]`)) return;
      close();
    };
    // A fixed menu does not follow the list; close it when anything scrolls.
    const onScroll = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  };

  const item = "w-full rounded px-2 py-1 text-left text-sm text-foreground hover:bg-accent focus:bg-accent focus:outline-none";
  const run = (action: () => void) => () => {
    action();
    close();
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={ctx.t.actionsFor(thread.displayTitle)}
      onKeyDown={onKeyDown}
      className="fixed z-50 rounded-md border border-border bg-popover p-1 shadow-lg"
      style={{
        width: MENU_WIDTH,
        left: Math.max(4, Math.min((anchor?.right ?? MENU_WIDTH) - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 4)),
        top: Math.max(
          4,
          (anchor?.bottom ?? 0) + MENU_HEIGHT > window.innerHeight
            ? (anchor?.top ?? 0) - MENU_HEIGHT
            : (anchor?.bottom ?? 0) + 2,
        ),
      }}
    >
      <button type="button" role="menuitem" className={item} onClick={run(() => void actions.setPinned(thread.id, !thread.isPinned))}>
        {thread.isPinned ? ctx.t.unpin : ctx.t.pin}
      </button>
      <button type="button" role="menuitem" className={item} onClick={run(() => void actions.setRead(thread.id, thread.isUnread))}>
        {thread.isUnread ? ctx.t.markRead : ctx.t.markUnread}
      </button>
      <button type="button" role="menuitem" className={item} onClick={run(() => ctx.setRenamingId(thread.id))}>
        {ctx.t.rename}
      </button>
      <div className="my-1 h-px bg-border" role="separator" />
      <button type="button" role="menuitem" className={item} onClick={run(() => actions.archive(thread.id))}>
        {ctx.t.archive}
      </button>
      <button
        type="button"
        role="menuitem"
        className={`${item} text-destructive`}
        onClick={run(() => actions.requestDelete(thread.id))}
      >
        {ctx.t.remove}
      </button>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "latest",
    title: "Show Latest Threads",
    description: "Thread list that can hide everything idle for more than 24, 48 or 72 hours.",
    component: LatestThreadsList,
  });
});
