import { getTranslations } from "next-intl/server";
import { requireOnboardingComplete } from "@/lib/onboarding/server-access";
import { CONTENT_FORMATS, contentPieceSchema, type ContentFormat } from "@/lib/product-surfaces/definitions";
import { listProductRecords } from "@/lib/product-surfaces/repository";
import { ContentBuilder } from "./ContentBuilder";
import { loadContentEditorOptions } from "@/lib/product-surfaces/content-editor-options";
import { resolveActiveContentFormatDefinition, resolveContentFormatDefinitionReference } from "@/lib/product-surfaces/content-format-registry";

export const dynamic = "force-dynamic";

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ format?: string; piece?: string }> }) {
  const query = await searchParams;
  const requestedFormat = CONTENT_FORMATS.includes(query.format as ContentFormat) ? query.format as ContentFormat : "talking_head_ugc";
  const { aggregate } = await requireOnboardingComplete("/content");
  const workspaceId = aggregate?.session.workspaceId;
  const t = await getTranslations("product.content");
  if (!workspaceId) return null;

  const [rows, options] = await Promise.all([
    listProductRecords({ workspaceId, kinds: ["content_piece"] }),
    loadContentEditorOptions(workspaceId),
  ]);
  const pieces = rows.map(({ id, title, revision, payload }) => ({ id, title, revision, payload }));
  const selectedPiece = pieces.find((piece) => piece.id === query.piece) ?? null;
  const selectedPayload = selectedPiece ? contentPieceSchema.parse(selectedPiece.payload) : null;
  const selectedFormat = selectedPayload?.format ?? requestedFormat;
  const resolvedDefinition = selectedPayload?.formatDefinition
    ? await resolveContentFormatDefinitionReference(selectedFormat, selectedPayload.formatDefinition)
    : await resolveActiveContentFormatDefinition(selectedFormat);

  return <main className="flex-1 px-5 py-8 sm:px-8 lg:px-10"><div className="mx-auto max-w-[1500px]"><header className="mb-7"><p className="text-xs font-semibold uppercase tracking-[.18em] text-amber-600">{t("eyebrow")}</p><h1 className="mt-2 text-3xl font-semibold sm:text-4xl">{t("title")}</h1><p className="mt-2 max-w-3xl text-muted-foreground">{t("description")}</p></header><ContentBuilder selectedFormat={selectedFormat} selectedPiece={selectedPiece} pieces={pieces} options={options} definition={resolvedDefinition.definition} /></div></main>;
}
