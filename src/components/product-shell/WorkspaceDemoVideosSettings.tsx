"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, FileVideo, LoaderCircle, Plus, Trash2, UploadCloud } from "lucide-react";
import { getDirection } from "@/i18n/config";
import { DEMO_VIDEO_MAX_BYTES, DEMO_VIDEO_MAX_DURATION_SECONDS } from "@/lib/product-surfaces/media-set-policy";
import type { MediaSetAssetSummary, MediaSetsSummary } from "@/lib/product-surfaces/media-set-summary";

type ApiBody = { success?: boolean; data?: MediaSetsSummary; assetId?: string; uploadUrl?: string; code?: string; error?: string };

export function WorkspaceDemoVideosSettings({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const t = useTranslations("product.demoVideosSettings") as (key: string, values?: Record<string, string | number>) => string;
  const locale = useLocale() as "ar" | "en";
  const inputRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<MediaSetsSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = data?.sets[0] ?? null;
  const errorText = (code: string) => t(`errors.${["DEMO_VIDEO_FORMAT_INVALID", "DEMO_VIDEO_SIZE_INVALID", "DEMO_VIDEO_DURATION_INVALID", "MEDIA_SET_REVISION_CONFLICT", "UPLOAD_FAILED"].includes(code) ? code : "REQUEST_FAILED"}`);

  const request = useCallback(async (path: string, body?: Record<string, unknown>, method = "GET") => {
    const response = await fetch(path, { method, cache: "no-store", headers: { "x-workspace-id": workspaceId, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json() as ApiBody;
    if (!response.ok || !result.success) throw new Error(result.code ?? result.error ?? "REQUEST_FAILED");
    return result;
  }, [workspaceId]);

  const load = useCallback(async () => {
    setError("");
    const result = await request("/api/product-library/media-sets?purpose=demo_videos");
    if (!result.data) throw new Error("REQUEST_FAILED");
    setData({ ...result.data, sets: result.data.sets.map((collection) => ({ ...collection, assets: [...collection.assets, ...collection.unavailableAssetIds.map((id) => ({ id, name: id, mimeType: null, sizeBytes: null, durationSeconds: null, width: null, height: null, createdAt: result.data!.measuredAt, eligibilityIssue: "MEDIA_SET_ASSET_NOT_AVAILABLE" }))], unavailableAssetIds: [] })) });
  }, [request]);

  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "REQUEST_FAILED")); }, [load]);

  async function save(assetIds: string[]) {
    setBusy(true); setError("");
    try {
      const base = { title: set?.title ?? t("defaultSetName"), assetIds, category: "demo_videos", description: t("defaultSetDescription"), purpose: "demo_videos", idempotencyKey: crypto.randomUUID() };
      await request("/api/product-library/media-sets", set ? { ...base, id: set.id, expectedRevision: set.revision } : base, set ? "PATCH" : "POST");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "REQUEST_FAILED");
      await load().catch(() => undefined);
    } finally { setBusy(false); }
  }

  async function readDuration(file: File) {
    const url = URL.createObjectURL(file);
    try {
      return await new Promise<number>((resolve, reject) => {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () => resolve(video.duration);
        video.onerror = () => reject(new Error("DEMO_VIDEO_DURATION_INVALID"));
        video.src = url;
      });
    } finally { URL.revokeObjectURL(url); }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const mimeType = file.type.toLowerCase();
      if (!["video/mp4", "video/quicktime"].includes(mimeType)) throw new Error("DEMO_VIDEO_FORMAT_INVALID");
      if (file.size <= 0 || file.size > DEMO_VIDEO_MAX_BYTES) throw new Error("DEMO_VIDEO_SIZE_INVALID");
      const duration = await readDuration(file);
      if (!Number.isFinite(duration) || duration <= 0 || duration > DEMO_VIDEO_MAX_DURATION_SECONDS) throw new Error("DEMO_VIDEO_DURATION_INVALID");
      const presign = await request("/api/studio/assets/presign", { assetType: "video", fileName: file.name, contentType: mimeType, expectedSizeBytes: file.size }, "POST");
      if (!presign.assetId || !presign.uploadUrl) throw new Error("REQUEST_FAILED");
      const stored = await fetch(presign.uploadUrl, { method: "PUT", headers: { "Content-Type": mimeType }, body: file });
      if (!stored.ok) throw new Error("UPLOAD_FAILED");
      await request(`/api/studio/assets/${encodeURIComponent(presign.assetId)}`, { uploadState: "ready", sizeBytes: file.size, mimeType }, "PATCH");
      const assetIds = [...(set?.assetIds ?? []), presign.assetId];
      const base = { title: set?.title ?? t("defaultSetName"), assetIds, category: "demo_videos", description: t("defaultSetDescription"), purpose: "demo_videos", idempotencyKey: crypto.randomUUID() };
      await request("/api/product-library/media-sets", set ? { ...base, id: set.id, expectedRevision: set.revision } : base, set ? "PATCH" : "POST");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "REQUEST_FAILED");
      await load().catch(() => undefined);
    } finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  function move(id: string, offset: -1 | 1) {
    if (!set) return;
    const current = set.assetIds.indexOf(id); const target = current + offset;
    if (current < 0 || target < 0 || target >= set.assetIds.length) return;
    const next = [...set.assetIds]; [next[current], next[target]] = [next[target]!, next[current]!];
    void save(next);
  }

  if (!data) return <div dir={getDirection(locale)} className="p-6">{error ? <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{errorText(error)}</p><button onClick={() => void load().catch(() => setError("REQUEST_FAILED"))} className="min-h-10 rounded-lg border px-3 text-sm font-semibold">{t("retry")}</button></div> : <LoaderCircle className="size-5 animate-spin" aria-label={t("loading")} />}</div>;

  const members = set?.assetIds.map((id) => set.assets.find((asset) => asset.id === id)).filter((asset): asset is MediaSetAssetSummary => Boolean(asset)) ?? [];
  const memberIds = new Set(members.map((asset) => asset.id));
  const available = data.eligibleAssets.filter((asset) => !memberIds.has(asset.id));
  const format = (asset: MediaSetAssetSummary) => asset.eligibilityIssue ? t("collection.ineligible") : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format((asset.sizeBytes ?? 0) / 1024 / 1024)} ${t("mb")} · ${new Intl.NumberFormat(locale).format(asset.durationSeconds ?? 0)} ${t("seconds")}`;

  return <div dir={getDirection(locale)} className="space-y-7 p-5 sm:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-2xl font-semibold">{t("title")}</h2><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t("description")}</p></div><Link href="/library?tab=media" className="inline-flex min-h-10 items-center rounded-lg border px-4 text-sm font-semibold">{t("openLibrary")}</Link></header>
    <section className="rounded-2xl border p-5"><h3 className="font-semibold">{t("requirements.title")}</h3><ul className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3"><li>{t("requirements.formats")}</li><li>{t("requirements.size")}</li><li>{t("requirements.duration")}</li></ul><p className="mt-4 text-xs text-muted-foreground">{t("requirements.evidence")}</p></section>
    {canManage ? <section className="rounded-2xl border p-5"><h3 className="font-semibold">{t("upload.title")}</h3><p className="mt-2 text-sm text-muted-foreground">{t("upload.description")}</p><input ref={inputRef} type="file" accept="video/mp4,video/quicktime,.mp4,.mov" className="sr-only" onChange={(event) => void upload(event.target.files?.[0])} /><button disabled={busy} onClick={() => inputRef.current?.click()} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-300 px-5 font-semibold text-stone-950 disabled:opacity-50">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}{t("upload.action")}</button></section> : <p className="rounded-xl border p-4 text-sm text-muted-foreground">{t("readOnly")}</p>}
    {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{errorText(error)}</p> : null}
    <section><div className="flex items-end justify-between gap-3"><div><h3 className="font-semibold">{t("collection.title")}</h3><p className="mt-1 text-sm text-muted-foreground">{t("collection.description")}</p></div><span className="text-sm font-semibold tabular-nums">{t("collection.count", { count: set?.assetIds.length ?? 0 })}</span></div>{members.length ? <div className="mt-3 grid gap-3">{members.map((asset) => { const index = set!.assetIds.indexOf(asset.id); return <article key={asset.id} className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${asset.eligibilityIssue ? "border-destructive/40" : ""}`}><FileVideo className="size-5 text-amber-600" /><div className="min-w-0 flex-1"><p dir="auto" className="truncate font-medium">{asset.name}</p><p className="text-xs text-muted-foreground"><bdi>{format(asset)}</bdi></p></div>{canManage ? <div className="flex gap-1"><button disabled={busy || index === 0} aria-label={t("moveUp", { name: asset.name })} onClick={() => move(asset.id, -1)} className="grid size-10 place-items-center rounded-lg border disabled:opacity-40"><ArrowUp className="size-4" /></button><button disabled={busy || index === set!.assetIds.length - 1} aria-label={t("moveDown", { name: asset.name })} onClick={() => move(asset.id, 1)} className="grid size-10 place-items-center rounded-lg border disabled:opacity-40"><ArrowDown className="size-4" /></button><button disabled={busy} aria-label={t("remove", { name: asset.name })} onClick={() => void save(set!.assetIds.filter((id) => id !== asset.id))} className="grid size-10 place-items-center rounded-lg border text-destructive disabled:opacity-40"><Trash2 className="size-4" /></button></div> : null}</article>; })}{set?.unavailableAssetIds.map((id) => <article key={id} className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 p-3"><FileVideo className="size-5 text-destructive" /><div className="min-w-0 flex-1"><p dir="auto" className="truncate font-medium">{id}</p><p className="text-xs text-destructive">{t("collection.unavailable")}</p></div>{canManage ? <button disabled={busy} aria-label={t("remove", { name: id })} onClick={() => void save(set.assetIds.filter((assetId) => assetId !== id))} className="grid size-10 place-items-center rounded-lg border text-destructive"><Trash2 className="size-4" /></button> : null}</article>)}</div> : <p className="mt-3 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t("collection.empty")}</p>}</section>
    {available.length > 0 && canManage ? <section><h3 className="font-semibold">{t("existing.title")}</h3><p className="mt-1 text-sm text-muted-foreground">{t("existing.description")}</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{available.map((asset) => <button key={asset.id} disabled={busy} onClick={() => void save([...(set?.assetIds ?? []), asset.id])} className="flex min-h-16 items-center gap-3 rounded-xl border p-3 text-start disabled:opacity-50"><Plus className="size-4 text-amber-600" /><span className="min-w-0"><span dir="auto" className="block truncate text-sm font-medium">{asset.name}</span><span className="block text-xs text-muted-foreground"><bdi>{format(asset)}</bdi></span></span></button>)}</div></section> : null}
    <section className="rounded-2xl border p-5"><h3 className="font-semibold">{t("boundary.title")}</h3><p className="mt-2 text-sm text-muted-foreground">{t("boundary.description")}</p></section>
  </div>;
}
