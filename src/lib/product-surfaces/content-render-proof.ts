import { z } from "zod";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { ContentFormatDefinition } from "./content-format-definition";

const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/).transform((value) => value as `sha256:${string}`);
const passed = z.literal("passed");
const reportSchema = z.object({
  assetId: z.string().min(1).max(200),
  contentDigest: sha256,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationSeconds: z.number().positive(),
  checks: z.object({
    fonts: z.object({ status: passed, fontManifestDigest: sha256, missingGlyphCount: z.literal(0) }).strict(),
    bidi: z.object({ status: passed, paragraphCount: z.number().int().nonnegative(), visualOrderDigest: sha256 }).strict(),
    captions: z.discriminatedUnion("status", [
      z.object({ status: passed, cueCount: z.number().int().positive(), overflowCount: z.literal(0), cueLayoutDigest: sha256 }).strict(),
      z.object({ status: z.literal("not_applicable"), cueCount: z.literal(0), overflowCount: z.literal(0), cueLayoutDigest: z.null() }).strict(),
    ]),
    timing: z.object({ status: passed, firstFrameMs: z.number().int().nonnegative(), lastFrameMs: z.number().int().positive(), audioSyncMaxDriftMs: z.number().int().nonnegative().max(100), timelineDigest: sha256 }).strict(),
    safeAreas: z.object({ status: passed, violationCount: z.literal(0), layoutDigest: sha256, preset: z.literal("short-form-v1") }).strict(),
  }).strict(),
  producedAt: z.string().datetime({ offset: true }),
}).strict();

export type ContentRenderInspectionReport = z.infer<typeof reportSchema>;
export type ContentRenderProof = ReturnType<typeof buildQualifiedContentRenderProof>;

export interface ContentRenderProofVerifier {
  inspect(input: {
    assetId: string;
    contentDigest: `sha256:${string}`;
    downloadUrl: string;
    requirements: {
      aspectRatio: "9:16";
      minimumDurationSeconds: number;
      maximumDurationSeconds: number;
      captionsRequired: boolean;
      bidiRequired: boolean;
      safeAreaPreset: "short-form-v1";
    };
  }): Promise<{ verifier: { id: string; version: string; qualificationDigest: `sha256:${string}` }; report: ContentRenderInspectionReport }>;
}

export class ContentRenderProofError extends Error {
  constructor(readonly code: "CONTENT_RENDER_PROOF_UNAVAILABLE" | "CONTENT_RENDER_PROOF_INVALID" | "CONTENT_RENDER_PROOF_FAILED") { super(code); }
}

export function buildQualifiedContentRenderProof(input: {
  definition: ContentFormatDefinition;
  definitionDigest: `sha256:${string}`;
  inputAssets: Array<{ assetId: string; type: "image" | "video"; contentDigest: `sha256:${string}` }>;
  output: { assetId: string; contentDigest: `sha256:${string}` };
  intentId: string | null;
  operationId: string | null;
  contentLanguage: "ar" | "en" | "mixed";
  report: ContentRenderInspectionReport;
  verifier: { id: string; version: string; qualificationDigest: `sha256:${string}` };
  verifiedAt: Date;
}) {
  const report = reportSchema.parse(input.report);
  const definition = input.definition;
  const producedAt = new Date(report.producedAt);
  if (
    report.assetId !== input.output.assetId
    || report.contentDigest !== input.output.contentDigest
    || report.width * 16 !== report.height * 9
    || report.width < 1080
    || report.height < 1920
    || report.durationSeconds < definition.duration.minimumSeconds
    || report.durationSeconds > definition.duration.maximumSeconds
    || producedAt > new Date(input.verifiedAt.getTime() + 60_000)
    || producedAt < new Date(input.verifiedAt.getTime() - 10 * 60_000)
    || (definition.captions.required && report.checks.captions.status !== "passed")
    || (!definition.captions.required && report.checks.captions.status !== "not_applicable" && report.checks.captions.status !== "passed")
    || (definition.captions.bidiProofRequired && input.contentLanguage !== "en" && report.checks.bidi.paragraphCount < 1)
    || report.checks.timing.firstFrameMs > 100
    || report.checks.timing.lastFrameMs > Math.ceil(report.durationSeconds * 1_000)
  ) throw new ContentRenderProofError("CONTENT_RENDER_PROOF_FAILED");
  const facts = {
    schema: "content-render-proof/v2" as const,
    status: "passed" as const,
    formatDefinition: { id: definition.id, revision: definition.revision, digest: input.definitionDigest },
    inputAssets: input.inputAssets,
    output: { assetId: report.assetId, contentDigest: report.contentDigest, width: report.width, height: report.height, durationSeconds: report.durationSeconds },
    checks: report.checks,
    intentId: input.intentId,
    operationId: input.operationId,
    verifier: { kind: "qualified_internal" as const, adapterId: input.verifier.id, adapterVersion: input.verifier.version, qualificationDigest: input.verifier.qualificationDigest },
    reportDigest: canonicalDigest(report) as `sha256:${string}`,
    verifiedAt: input.verifiedAt.toISOString(),
  };
  return { ...facts, digest: canonicalDigest(facts) as `sha256:${string}` };
}

export function createConfiguredContentRenderProofVerifier(input: {
  endpoint?: string;
  token?: string;
  verifierId?: string;
  verifierVersion?: string;
  qualificationDigest?: string;
  fetchImpl?: typeof fetch;
}): ContentRenderProofVerifier {
  const fetchImpl = input.fetchImpl ?? fetch;
  return { async inspect(request) {
    if (!input.endpoint || !input.token || !input.verifierId || !input.verifierVersion || !/^sha256:[a-f0-9]{64}$/.test(input.qualificationDigest ?? "")) throw new ContentRenderProofError("CONTENT_RENDER_PROOF_UNAVAILABLE");
    let endpoint: URL;
    try { endpoint = new URL(input.endpoint); } catch { throw new ContentRenderProofError("CONTENT_RENDER_PROOF_UNAVAILABLE"); }
    if (process.env.NODE_ENV === "production" && endpoint.protocol !== "https:") throw new ContentRenderProofError("CONTENT_RENDER_PROOF_UNAVAILABLE");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetchImpl(endpoint, { method: "POST", headers: { authorization: `Bearer ${input.token}`, "content-type": "application/json" }, body: JSON.stringify({ schema: "content-render-inspection/v1", ...request }), signal: controller.signal, cache: "no-store" });
    } catch {
      throw new ContentRenderProofError("CONTENT_RENDER_PROOF_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 128_000) throw new ContentRenderProofError("CONTENT_RENDER_PROOF_UNAVAILABLE");
    const parsed = z.object({ verifierId: z.string().min(1).max(200), verifierVersion: z.string().min(1).max(200), report: reportSchema }).strict().safeParse(await response.json().catch(() => null));
    if (!parsed.success || parsed.data.verifierId !== input.verifierId || parsed.data.verifierVersion !== input.verifierVersion) throw new ContentRenderProofError("CONTENT_RENDER_PROOF_INVALID");
    return { verifier: { id: parsed.data.verifierId, version: parsed.data.verifierVersion, qualificationDigest: input.qualificationDigest as `sha256:${string}` }, report: parsed.data.report };
  } };
}

export function productionContentRenderProofVerifier() {
  return createConfiguredContentRenderProofVerifier({ endpoint: process.env.CONTENT_RENDER_PROOF_VERIFIER_URL, token: process.env.CONTENT_RENDER_PROOF_VERIFIER_TOKEN, verifierId: process.env.CONTENT_RENDER_PROOF_VERIFIER_ID, verifierVersion: process.env.CONTENT_RENDER_PROOF_VERIFIER_VERSION, qualificationDigest: process.env.CONTENT_RENDER_PROOF_VERIFIER_QUALIFICATION_DIGEST });
}
