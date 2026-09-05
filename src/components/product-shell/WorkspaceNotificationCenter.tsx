"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { BellIcon, LoaderCircle } from "lucide-react";
import { getActiveWorkspaceId } from "@/lib/studio/client";

type Notification = {
  id: string;
  title: string;
  body: string;
  actionLabel: string;
  actionPath: string;
  occurredAt: string;
  read: boolean;
  severity: string;
};

export function WorkspaceNotificationCenter({ workspaceId, authorizedWorkspaces }: { workspaceId: string | null; authorizedWorkspaces: Array<{ id: string }> }) {
  const t = useTranslations("shell.notifications");
  const locale = useLocale();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedWorkspaceId = getActiveWorkspaceId();
    const resolvedWorkspaceId = storedWorkspaceId && authorizedWorkspaces.some((workspace) => workspace.id === storedWorkspaceId) ? storedWorkspaceId : workspaceId;
    if (!resolvedWorkspaceId) { setItems([]); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    void fetch("/api/studio/notifications?limit=20", { headers: { "x-workspace-id": resolvedWorkspaceId }, cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { success?: boolean; notifications?: Notification[] };
        if (!response.ok || !body.success || !body.notifications) throw new Error("NOTIFICATIONS_LOAD_FAILED");
        setItems(body.notifications);
      })
      .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setItems([]); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [authorizedWorkspaces, workspaceId]);

  const unread = items.filter((item) => !item.read).length;
  function markRead(id: string) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, read: true } : item));
    const storedWorkspaceId = getActiveWorkspaceId();
    const resolvedWorkspaceId = storedWorkspaceId && authorizedWorkspaces.some((workspace) => workspace.id === storedWorkspaceId) ? storedWorkspaceId : workspaceId;
    if (resolvedWorkspaceId) void fetch(`/api/studio/notifications/${encodeURIComponent(id)}/read`, { method: "POST", headers: { "x-workspace-id": resolvedWorkspaceId } }).catch(() => {});
  }

  return <details className="group relative">
    <summary aria-label={t("open")} className="relative flex size-10 cursor-pointer list-none items-center justify-center rounded-lg border bg-background hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
      <BellIcon className="size-4" />
      {unread > 0 ? <span className="absolute -end-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-5 text-white" aria-label={t("unread", { count: unread })}>{Math.min(unread, 99)}</span> : null}
    </summary>
    <section className="fixed inset-x-4 top-14 z-50 w-auto overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-xl sm:absolute sm:inset-x-auto sm:end-0 sm:top-auto sm:mt-2 sm:w-[min(24rem,calc(100vw-2rem))]" aria-label={t("title")}>
      <header className="border-b px-4 py-3"><h2 className="font-semibold">{t("title")}</h2><p className="text-xs text-muted-foreground">{t("description")}</p></header>
      <div className="max-h-[28rem] overflow-y-auto">
        {loading ? <div className="flex min-h-24 items-center justify-center"><LoaderCircle className="size-5 animate-spin" aria-label={t("loading")} /></div> : items.length === 0 ? <p className="p-5 text-sm text-muted-foreground">{t("empty")}</p> : <ol className="divide-y">{items.map((item) => <li key={item.id} className={item.read ? "p-4" : "bg-amber-50/70 p-4 dark:bg-amber-950/20"}>
          <div className="flex items-start gap-3"><span aria-hidden="true" className={`mt-1 size-2 shrink-0 rounded-full ${item.severity === "critical" ? "bg-red-600" : item.severity === "warning" ? "bg-amber-500" : "bg-sky-500"}`} /><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">{item.title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.body}</p><time className="mt-2 block text-[11px] text-muted-foreground" dateTime={item.occurredAt}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.occurredAt))}</time><div className="mt-3 flex flex-wrap items-center gap-3"><Link href={item.actionPath} onClick={() => markRead(item.id)} className="text-xs font-semibold text-amber-700 underline-offset-4 hover:underline dark:text-amber-300">{item.actionLabel}</Link>{!item.read ? <button type="button" onClick={() => markRead(item.id)} className="text-xs text-muted-foreground underline-offset-4 hover:underline">{t("markRead")}</button> : null}</div></div></div>
        </li>)}</ol>}
      </div>
    </section>
  </details>;
}
