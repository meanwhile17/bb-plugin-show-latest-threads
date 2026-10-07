// Pure selection and ordering rules for the list, kept free of React and the
// SDK runtime so they can be unit-tested with plain Node.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

export type SidebarThreadLike = Pick<
  PluginSidebarThread,
  | "id"
  | "parentThreadId"
  | "status"
  | "indicator"
  | "activity"
  | "hasPendingInteraction"
  | "updatedAt"
  | "latestAttentionAt"
  | "lastReadAt"
  | "pinSortKey"
  | "pinnedAt"
>;


export function lastTouched(thread: SidebarThreadLike): number {
  return Math.max(thread.updatedAt, thread.latestAttentionAt, thread.lastReadAt ?? 0);
}

export function lastActivity(thread: SidebarThreadLike): number {
  return Math.max(thread.updatedAt, thread.latestAttentionAt);
}

export function isBusy(thread: SidebarThreadLike): boolean {
  const a = thread.activity;
  return (
    thread.status === "starting" ||
    thread.status === "active" ||
    thread.status === "stopping" ||
    thread.indicator === "runtime" ||
    a.workflows + a.backgroundAgents + a.backgroundCommands + a.planMode + a.goals > 0
  );
}

export function needsUser(thread: SidebarThreadLike): boolean {
  return thread.hasPendingInteraction || thread.indicator === "waiting-for-input";
}

/**
 * Ids of the threads to show: visible threads touched since `cutoff`, plus
 * the active thread and anything running or waiting for the user, plus the
 * parents of every kept thread so the tree stays intact.
 */
export function selectRecent(
  threads: readonly SidebarThreadLike[],
  cutoff: number,
  activeThreadId: string | null,
): Set<string> {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const keep = new Set<string>();
  for (const thread of threads) {
    const wanted =
      thread.id === activeThreadId ||
      isBusy(thread) ||
      needsUser(thread) ||
      lastTouched(thread) >= cutoff;
    if (!wanted) continue;
    let current: SidebarThreadLike | undefined = thread;
    let guard = 0;
    while (current && !keep.has(current.id) && guard++ < 64) {
      keep.add(current.id);
      current = current.parentThreadId ? byId.get(current.parentThreadId) : undefined;
    }
  }
  return keep;
}

export function compareThreads(a: SidebarThreadLike, b: SidebarThreadLike): number {
  const busy = Number(isBusy(b)) - Number(isBusy(a));
  return busy !== 0 ? busy : lastActivity(b) - lastActivity(a);
}

export function comparePinned(a: SidebarThreadLike, b: SidebarThreadLike): number {
  if (a.pinSortKey !== null && b.pinSortKey !== null) {
    return a.pinSortKey < b.pinSortKey ? -1 : a.pinSortKey > b.pinSortKey ? 1 : 0;
  }
  if (a.pinSortKey !== null) return -1;
  if (b.pinSortKey !== null) return 1;
  return (a.pinnedAt ?? 0) - (b.pinnedAt ?? 0);
}

