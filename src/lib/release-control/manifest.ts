import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/);
const dimension = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/);
const route = z.string().startsWith("/").max(240);
const metric = z.enum(["largest_contentful_paint_ms", "interaction_to_next_paint_ms", "cumulative_layout_shift_milli", "critical_action_p95_ms", "api_p95_ms", "job_stage_p95_ms"]);
const unique = <T>(values: T[]): boolean => new Set(values).size === values.length;
const coordinate = (value: { route: string; feature: string; state: string; role: string; entitlement: string; viewport: string; direction: string }) => [value.route, value.feature, value.state, value.role, value.entitlement, value.viewport, value.direction].join("\u0000");

export const supportedClientSchema = z.object({ id: dimension, engine: z.enum(["chromium", "webkit", "gecko"]), version: z.string().regex(/^(?:\d+\.){1,3}\d+(?:[-+][A-Za-z0-9.-]+)?$/), capabilities: z.array(dimension).min(1).max(30) }).strict().superRefine((value, ctx) => { if (!unique(value.capabilities)) ctx.addIssue({ code: "custom", path: ["capabilities"], message: "Client capabilities must be unique." }); });
export const performanceRequirementSchema = z.object({ id, route, clientId: dimension, locale: z.enum(["ar", "en"]), metric, budget: z.number().finite().positive(), cacheState: z.enum(["cold", "warm"]), userRegion: z.literal("mena"), providerRegion: dimension, criticalAction: dimension.nullable(), jobStage: dimension.nullable() }).strict().superRefine((value, ctx) => {
  if ((value.metric === "critical_action_p95_ms") !== Boolean(value.criticalAction)) ctx.addIssue({ code: "custom", path: ["criticalAction"], message: "Critical-action budgets require an exact action dimension." });
  if ((value.metric === "job_stage_p95_ms") !== Boolean(value.jobStage)) ctx.addIssue({ code: "custom", path: ["jobStage"], message: "Job-stage budgets require an exact stage dimension." });
});
export const parityManifestCellSchema = z.object({ id, route, feature: dimension, state: dimension, role: dimension, entitlement: dimension, viewport: z.enum(["mobile", "tablet", "desktop"]), direction: z.enum(["rtl", "ltr"]) }).strict();
const parityMatrixSchema = z.object({ dimensions: z.object({ routes: z.array(route).min(1).max(200), features: z.array(dimension).min(1).max(100), states: z.array(dimension).min(1).max(30), roles: z.array(dimension).min(1).max(20), entitlements: z.array(dimension).min(1).max(20), viewports: z.array(z.enum(["mobile", "tablet", "desktop"])).min(1).max(3), directions: z.array(z.enum(["rtl", "ltr"])).length(2) }).strict(), cells: z.array(parityManifestCellSchema).min(1).max(20_000) }).strict();

export const releaseManifestSchema = z.object({
  schema: z.literal("release-manifest/v2"), id: z.string().regex(/^manifest_[A-Za-z0-9._-]{4,100}$/), version: z.number().int().positive(), workspaceId: z.string().min(1).max(200), buildId: z.string().min(1).max(120),
  requiredRoutes: z.array(route).min(1).max(200), supportedClients: z.array(supportedClientSchema).min(1).max(30), performanceRequirements: z.array(performanceRequirementSchema).min(1).max(20_000), dataClasses: z.array(dimension).min(1).max(100), contracts: z.array(z.string().min(1).max(160)).min(1).max(100), parityMatrix: parityMatrixSchema,
  issuedAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }), keyId: dimension,
}).strict().superRefine((value, ctx) => {
  for (const [key, values] of Object.entries(value.parityMatrix.dimensions)) if (!unique(values)) ctx.addIssue({ code: "custom", path: ["parityMatrix", "dimensions", key], message: "Every matrix dimension must be unique." });
  for (const [key, values] of [["requiredRoutes", value.requiredRoutes], ["dataClasses", value.dataClasses], ["contracts", value.contracts]] as const) if (!unique(values)) ctx.addIssue({ code: "custom", path: [key], message: "Manifest inventory must be unique." });
  const clientIds = value.supportedClients.map((client) => client.id); if (!unique(clientIds)) ctx.addIssue({ code: "custom", path: ["supportedClients"], message: "Supported client IDs must be unique." });
  if (value.requiredRoutes.length !== value.parityMatrix.dimensions.routes.length || value.requiredRoutes.some((item) => !value.parityMatrix.dimensions.routes.includes(item))) ctx.addIssue({ code: "custom", path: ["parityMatrix", "dimensions", "routes"], message: "The parity matrix must cover every required route exactly." });
  const expectedCells = new Set<string>(); const d = value.parityMatrix.dimensions;
  for (const matrixRoute of d.routes) for (const feature of d.features) for (const state of d.states) for (const role of d.roles) for (const entitlement of d.entitlements) for (const viewport of d.viewports) for (const cellDirection of d.directions) expectedCells.add(coordinate({ route: matrixRoute, feature, state, role, entitlement, viewport, direction: cellDirection }));
  const actualCells = value.parityMatrix.cells.map(coordinate); const cellIds = value.parityMatrix.cells.map((cell) => cell.id);
  if (!unique(cellIds) || !unique(actualCells) || actualCells.length !== expectedCells.size || actualCells.some((item) => !expectedCells.has(item))) ctx.addIssue({ code: "custom", path: ["parityMatrix", "cells"], message: "The signed manifest must enumerate every required parity cell exactly once." });
  const performanceIds = value.performanceRequirements.map((item) => item.id); if (!unique(performanceIds)) ctx.addIssue({ code: "custom", path: ["performanceRequirements"], message: "Performance requirement IDs must be unique." });
  for (const requirement of value.performanceRequirements) if (!value.requiredRoutes.includes(requirement.route) || !clientIds.includes(requirement.clientId)) ctx.addIssue({ code: "custom", path: ["performanceRequirements"], message: "Performance requirements must reference a required route and concrete client." });
  for (const requiredRoute of value.requiredRoutes) for (const clientId of clientIds) for (const locale of ["ar", "en"] as const) for (const cacheState of ["cold", "warm"] as const) for (const requiredMetric of metric.options) if (!value.performanceRequirements.some((item) => item.route === requiredRoute && item.clientId === clientId && item.locale === locale && item.cacheState === cacheState && item.metric === requiredMetric)) ctx.addIssue({ code: "custom", path: ["performanceRequirements"], message: `Missing ${requiredMetric} budget for ${requiredRoute}/${clientId}/${locale}/${cacheState}.` });
});
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

function canonical(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`; }
export function signReleaseManifest(manifest: ReleaseManifest, secret: string): string { return `hmac-sha256:${createHmac("sha256", secret).update(canonical(manifest)).digest("hex")}`; }
export function loadReleaseManifest(input: { raw: string | undefined; signature: string | undefined; secret: string | undefined; workspaceId: string; now: Date }): ReleaseManifest {
  if (!input.raw || !input.signature || !input.secret || input.secret.length < 32) throw new TypeError("RELEASE_MANIFEST_MISSING");
  const manifest = releaseManifestSchema.parse(JSON.parse(input.raw)); if (manifest.workspaceId !== input.workspaceId || new Date(manifest.issuedAt) > input.now || new Date(manifest.expiresAt) <= input.now) throw new TypeError("RELEASE_MANIFEST_INVALID");
  const expected = signReleaseManifest(manifest, input.secret); const a = Buffer.from(expected); const b = Buffer.from(input.signature); if (a.length !== b.length || !timingSafeEqual(a, b)) throw new TypeError("RELEASE_MANIFEST_SIGNATURE_INVALID"); return manifest;
}
