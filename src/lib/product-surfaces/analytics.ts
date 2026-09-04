import "server-only";
import { and, desc, eq, gte } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { socialAccounts, socialEvents, socialPosts } from "@/lib/db/schema";
import { listProductRecords } from "./repository";

const metric = (metadata: Record<string, unknown> | null, key: string) => typeof metadata?.[key] === "number" && Number.isFinite(metadata[key]) ? Math.max(0, metadata[key] as number) : 0;
export async function getAudienceAnalytics(input: { workspaceId: string; days: 7 | 30 | 90; now?: Date }) { const now = input.now ?? new Date(); const from = new Date(now.getTime() - input.days * 86_400_000); const db = getDb(); const [posts, events, accounts, sources] = await Promise.all([
  db.select().from(socialPosts).where(and(eq(socialPosts.workspaceId, input.workspaceId), gte(socialPosts.createdAt, from))).orderBy(desc(socialPosts.createdAt)),
  db.select().from(socialEvents).where(and(eq(socialEvents.workspaceId, input.workspaceId), gte(socialEvents.createdAt, from))).orderBy(desc(socialEvents.createdAt)).limit(2_000),
  db.select({ id: socialAccounts.id, platform: socialAccounts.platform, name: socialAccounts.displayName }).from(socialAccounts).where(and(eq(socialAccounts.workspaceId, input.workspaceId), eq(socialAccounts.disabled, false))),
  listProductRecords({ workspaceId: input.workspaceId, kinds: ["website_analytics_source", "geo_analytics_source"] }),
]);
  const totals = events.reduce((sum, event) => ({ views: sum.views + metric(event.metadata, "views"), likes: sum.likes + metric(event.metadata, "likes"), comments: sum.comments + metric(event.metadata, "comments"), websiteViews: sum.websiteViews + metric(event.metadata, "websiteViews"), geoCitations: sum.geoCitations + metric(event.metadata, "geoCitations") }), { views: 0, likes: 0, comments: 0, websiteViews: 0, geoCitations: 0 });
  const perDay = Array.from({ length: input.days }, (_, offset) => { const day = new Date(from.getTime() + (offset + 1) * 86_400_000); const key = day.toISOString().slice(0, 10); const dayPosts = posts.filter((post) => post.createdAt.toISOString().slice(0, 10) === key); const dayEvents = events.filter((event) => event.createdAt.toISOString().slice(0, 10) === key); return { date: key, posts: dayPosts.length, views: dayEvents.reduce((sum, event) => sum + metric(event.metadata, "views"), 0), websiteViews: dayEvents.reduce((sum, event) => sum + metric(event.metadata, "websiteViews"), 0) }; });
  const platform = accounts.map((account) => ({ ...account, posts: posts.filter((post) => post.socialAccountId === account.id).length }));
  return { range: { from, to: now, days: input.days }, totals: { ...totals, posts: posts.length }, perDay, platform, sources, freshness: events[0]?.createdAt ?? null, empty: posts.length === 0 && events.length === 0 };
}

