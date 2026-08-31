import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import {
  brandAnalysisRuns,
  brandProfiles,
  brandSources,
  member,
  onboardingActivationArtifacts,
  onboardingAnalysisDispatchIntents,
  onboardingCommandReceipts,
  onboardingSessions,
  organization,
  user,
  userPreferences,
  workspaceMembers,
  workspaceSettings,
  workspaceStorageLimits,
  workspaces,
} from "@/lib/db/schema";
import {
  activationArtifactV1Schema,
  brandProfileV1Schema,
  contentLanguageSchema,
  interfaceLocaleSchema,
  onboardingAnswersV1Schema,
} from "./schemas";
import type {
  ActivationArtifactRecord,
  AnalysisDispatchIntentRecord,
  AnalysisGenerationContext,
  AnalysisRunTransition,
  BrandAnalysisRunRecord,
  BrandProfileRecord,
  BrandSourceRecord,
  CommandCommitInput,
  CommandCommitResult,
  OnboardingAggregate,
  OnboardingRepository,
  OnboardingSessionRecord,
  SourceExtractionUpdate,
} from "./repository";

type Db = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type SessionRow = typeof onboardingSessions.$inferSelect;
type SourceRow = typeof brandSources.$inferSelect;
type AnalysisRunRow = typeof brandAnalysisRuns.$inferSelect;
type ProfileRow = typeof brandProfiles.$inferSelect;
type ActivationArtifactRow = typeof onboardingActivationArtifacts.$inferSelect;
type DispatchIntentRow = typeof onboardingAnalysisDispatchIntents.$inferSelect;

function sessionRecord(row: SessionRow): OnboardingSessionRecord {
  return {
    ...row,
    answers: onboardingAnswersV1Schema.parse(row.answers),
    contentLanguage: contentLanguageSchema.parse(row.contentLanguage),
  };
}

function sourceRecord(row: SourceRow): BrandSourceRecord {
  return row;
}

function analysisRunRecord(row: AnalysisRunRow): BrandAnalysisRunRecord {
  return row;
}

function dispatchIntentRecord(row: DispatchIntentRow): AnalysisDispatchIntentRecord {
  return {
    ...row,
    status: row.status === "dispatched" ? "dispatched" : "pending",
  };
}

function profileRecord(row: ProfileRow): BrandProfileRecord {
  if (row.schemaVersion !== 1) {
    throw new Error(`Unsupported Brand Profile schema version: ${row.schemaVersion}`);
  }
  return {
    ...row,
    schemaVersion: 1,
    profile: brandProfileV1Schema.parse(row.profile),
  };
}

function activationArtifactRecord(
  row: ActivationArtifactRow,
): ActivationArtifactRecord {
  if (row.schemaVersion !== 1) {
    throw new Error(
      `Unsupported activation artifact schema version: ${row.schemaVersion}`,
    );
  }
  return {
    ...row,
    schemaVersion: 1,
    artifact: activationArtifactV1Schema.parse(row.artifact),
  };
}

async function readSessionById(
  database: Db | Transaction,
  sessionId: string,
): Promise<OnboardingSessionRecord | null> {
  const [row] = await database
    .select()
    .from(onboardingSessions)
    .where(eq(onboardingSessions.id, sessionId))
    .limit(1);
  return row ? sessionRecord(row) : null;
}

export class PostgresOnboardingRepository implements OnboardingRepository {
  constructor(private readonly db: Db) {}

  async getOrCreateSession(
    input: Parameters<OnboardingRepository["getOrCreateSession"]>[0],
  ): Promise<OnboardingSessionRecord> {
    interfaceLocaleSchema.parse(input.interfaceLocale);
    contentLanguageSchema.parse(input.contentLanguage);
    return this.db.transaction(async (tx) => {
      await tx
        .insert(userPreferences)
        .values({
          userId: input.userId,
          interfaceLocale: input.interfaceLocale,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoNothing();

      await tx
        .insert(onboardingSessions)
        .values({
          id: input.sessionId,
          userId: input.userId,
          status: "not_started",
          currentStep: "identity",
          answers: { schemaVersion: 1 },
          contentLanguage: input.contentLanguage,
          revision: 0,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoNothing({ target: onboardingSessions.userId });

      const [row] = await tx
        .select()
        .from(onboardingSessions)
        .where(eq(onboardingSessions.userId, input.userId))
        .limit(1);
      if (!row) throw new Error("Failed to create onboarding session.");
      return sessionRecord(row);
    });
  }

  async readAggregate(userId: string): Promise<OnboardingAggregate | null> {
    const [sessionRow] = await this.db
      .select()
      .from(onboardingSessions)
      .where(eq(onboardingSessions.userId, userId))
      .limit(1);
    if (!sessionRow) return null;

    const session = sessionRecord(sessionRow);
    const workspaceId = session.workspaceId;
    const [preferenceRows, settingRows, runRows, profileRows] = await Promise.all([
      this.db
        .select({ interfaceLocale: userPreferences.interfaceLocale })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .limit(1),
      workspaceId
        ? this.db
            .select({ contentLanguage: workspaceSettings.defaultContentLanguage })
            .from(workspaceSettings)
            .where(eq(workspaceSettings.workspaceId, workspaceId))
            .limit(1)
        : Promise.resolve([]),
      workspaceId
        ? this.db
            .select()
            .from(brandAnalysisRuns)
            .where(eq(brandAnalysisRuns.workspaceId, workspaceId))
            .orderBy(desc(brandAnalysisRuns.createdAt))
            .limit(1)
        : Promise.resolve([]),
      workspaceId
        ? this.db
            .select()
            .from(brandProfiles)
            .where(
              and(
                eq(brandProfiles.workspaceId, workspaceId),
                inArray(brandProfiles.status, ["draft", "active"]),
              ),
            )
            .orderBy(desc(brandProfiles.revision))
        : Promise.resolve([]),
    ]);

    const draftRow = profileRows.find((profile) => profile.status === "draft");
    const activeRow = profileRows.find((profile) => profile.status === "active");
    const artifactRows = activeRow
      ? await this.db
          .select()
          .from(onboardingActivationArtifacts)
          .where(
            and(
              eq(onboardingActivationArtifacts.workspaceId, activeRow.workspaceId),
              eq(onboardingActivationArtifacts.brandProfileId, activeRow.id),
            ),
          )
          .limit(1)
      : [];

    return {
      session,
      interfaceLocale: interfaceLocaleSchema.parse(
        preferenceRows[0]?.interfaceLocale ?? "ar",
      ),
      contentLanguage: contentLanguageSchema.parse(
        settingRows[0]?.contentLanguage ?? session.contentLanguage,
      ),
      analysis: runRows[0] ? analysisRunRecord(runRows[0]) : null,
      draftProfile: draftRow ? profileRecord(draftRow) : null,
      activeProfile: activeRow ? profileRecord(activeRow) : null,
      activationArtifact: artifactRows[0]
        ? activationArtifactRecord(artifactRows[0])
        : null,
    };
  }

  async readCommandReceipt(
    input: Parameters<OnboardingRepository["readCommandReceipt"]>[0],
  ) {
    const [receipt] = await this.db
      .select({
        requestFingerprint: onboardingCommandReceipts.requestFingerprint,
        sessionRevision: onboardingCommandReceipts.sessionRevision,
      })
      .from(onboardingCommandReceipts)
      .where(
        and(
          eq(onboardingCommandReceipts.userId, input.userId),
          eq(onboardingCommandReceipts.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (!receipt) return { kind: "absent" as const };
    return receipt.requestFingerprint === input.requestFingerprint
      ? { kind: "replayed" as const, sessionRevision: receipt.sessionRevision }
      : { kind: "conflict" as const };
  }

  async commitCommand(input: CommandCommitInput): Promise<CommandCommitResult> {
    onboardingAnswersV1Schema.parse(input.answers);
    return this.db.transaction(async (tx): Promise<CommandCommitResult> => {
      const [receipt] = await tx
        .select()
        .from(onboardingCommandReceipts)
        .where(
          and(
            eq(onboardingCommandReceipts.userId, input.userId),
            eq(onboardingCommandReceipts.idempotencyKey, input.receipt.idempotencyKey),
          ),
        )
        .limit(1);
      if (receipt) {
        if (receipt.requestFingerprint !== input.receipt.requestFingerprint) {
          return { kind: "conflict" };
        }
        const replayed = await readSessionById(tx, input.sessionId);
        return replayed
          ? { kind: "replayed", session: replayed }
          : { kind: "not_found" };
      }

      const [currentRow] = await tx
        .select()
        .from(onboardingSessions)
        .where(
          and(
            eq(onboardingSessions.id, input.sessionId),
            eq(onboardingSessions.userId, input.userId),
          ),
        )
        .limit(1)
        .for("update");
      if (!currentRow) return { kind: "not_found" };
      if (currentRow.revision !== input.expectedRevision) {
        return { kind: "stale_revision" };
      }

      const now = new Date();
      let workspaceId = currentRow.workspaceId;
      if (input.workspace) {
        interfaceLocaleSchema.parse(input.workspace.interfaceLocale);
        contentLanguageSchema.parse(input.workspace.contentLanguage);
        const [createdWorkspace] = await tx
          .insert(workspaces)
          .values({
            id: input.workspace.id,
            name: input.workspace.name,
            slug: input.workspace.slug,
            ownerUserId: input.workspace.ownerUserId,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .returning({ id: workspaces.id });
        if (!createdWorkspace && workspaceId !== input.workspace.id) {
          return { kind: "conflict" };
        }
        workspaceId = input.workspace.id;
        await tx
          .insert(organization)
          .values({
            id: input.workspace.organizationId,
            name: input.workspace.name,
            slug: input.workspace.slug,
            createdAt: now,
          })
          .onConflictDoNothing();
        await tx
          .insert(workspaceSettings)
          .values({
            workspaceId,
            organizationId: input.workspace.organizationId,
            planTier: "free",
            defaultContentLanguage: input.workspace.contentLanguage,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
        await tx
          .insert(workspaceMembers)
          .values({
            workspaceId,
            userId: input.workspace.ownerUserId,
            role: "owner",
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
        await tx
          .insert(member)
          .values({
            id: input.workspace.organizationMemberId,
            organizationId: input.workspace.organizationId,
            userId: input.workspace.ownerUserId,
            role: "owner",
            createdAt: now,
          })
          .onConflictDoNothing();
        await tx
          .insert(workspaceStorageLimits)
          .values({
            workspaceId,
            quotaBytes: input.workspace.quotaBytes,
            updatedAt: now,
          })
          .onConflictDoNothing();
        await tx
          .insert(userPreferences)
          .values({
            userId: input.userId,
            interfaceLocale: input.workspace.interfaceLocale,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: userPreferences.userId,
            set: {
              interfaceLocale: input.workspace.interfaceLocale,
              updatedAt: now,
            },
          });
        await tx
          .update(user)
          .set({ name: input.workspace.ownerName, updatedAt: now })
          .where(eq(user.id, input.userId));
      }

      if (input.source) {
        await tx.insert(brandSources).values(input.source);
      }
      if (input.analysisRun) {
        await tx.insert(brandAnalysisRuns).values(input.analysisRun);
        await tx.insert(onboardingAnalysisDispatchIntents).values({
          runId: input.analysisRun.id,
          workspaceId: input.analysisRun.workspaceId,
          status: "pending",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        });
      }
      if (input.activateProfileId) {
        if (!workspaceId) return { kind: "conflict" };
        const [draft] = await tx
          .select({ id: brandProfiles.id })
          .from(brandProfiles)
          .where(
            and(
              eq(brandProfiles.id, input.activateProfileId),
              eq(brandProfiles.workspaceId, workspaceId),
              eq(brandProfiles.status, "draft"),
            ),
          )
          .limit(1)
          .for("update");
        if (!draft) return { kind: "conflict" };
        await tx
          .update(brandProfiles)
          .set({ status: "superseded" })
          .where(
            and(
              eq(brandProfiles.workspaceId, workspaceId),
              eq(brandProfiles.status, "active"),
            ),
          );
        await tx
          .update(brandProfiles)
          .set({
            status: "active",
            acceptedByUserId: input.userId,
            acceptedAt: now,
          })
          .where(
            and(
              eq(brandProfiles.id, input.activateProfileId),
              eq(brandProfiles.workspaceId, workspaceId),
              eq(brandProfiles.status, "draft"),
            ),
          )
          .returning({ id: brandProfiles.id });
      }

      const [updatedRow] = await tx
        .update(onboardingSessions)
        .set({
          workspaceId,
          status: input.nextStatus,
          currentStep: input.nextStep,
          answers: input.answers,
          contentLanguage: input.workspace?.contentLanguage ?? currentRow.contentLanguage,
          revision: currentRow.revision + 1,
          completedAt: input.completedAt ?? currentRow.completedAt,
          updatedAt: now,
        })
        .where(
          and(
            eq(onboardingSessions.id, input.sessionId),
            eq(onboardingSessions.userId, input.userId),
            eq(onboardingSessions.revision, input.expectedRevision),
          ),
        )
        .returning();
      if (!updatedRow) return { kind: "stale_revision" };

      await tx.insert(onboardingCommandReceipts).values({
        userId: input.userId,
        idempotencyKey: input.receipt.idempotencyKey,
        commandType: input.receipt.commandType,
        requestFingerprint: input.receipt.requestFingerprint,
        sessionRevision: updatedRow.revision,
        result: {
          sessionId: updatedRow.id,
          revision: updatedRow.revision,
        },
        createdAt: now,
      });
      return { kind: "committed", session: sessionRecord(updatedRow) };
    });
  }

  async getBrandSource(workspaceId: string, sourceId: string) {
    const [row] = await this.db
      .select()
      .from(brandSources)
      .where(
        and(eq(brandSources.workspaceId, workspaceId), eq(brandSources.id, sourceId)),
      )
      .limit(1);
    return row ? sourceRecord(row) : null;
  }

  async updateSourceExtraction(input: SourceExtractionUpdate) {
    const [row] = await this.db
      .update(brandSources)
      .set({
        finalUrl: input.finalUrl,
        cleanedText: input.cleanedText,
        contentHash: input.contentHash,
        sourceLanguage: input.sourceLanguage,
        extractedBytes: input.extractedBytes,
        fetchedAt: input.fetchedAt,
      })
      .where(
        and(
          eq(brandSources.id, input.sourceId),
          eq(brandSources.workspaceId, input.workspaceId),
        ),
      )
      .returning();
    return row ? sourceRecord(row) : null;
  }

  async getAnalysisRun(workspaceId: string, runId: string) {
    const [row] = await this.db
      .select()
      .from(brandAnalysisRuns)
      .where(
        and(
          eq(brandAnalysisRuns.workspaceId, workspaceId),
          eq(brandAnalysisRuns.id, runId),
        ),
      )
      .limit(1);
    return row ? analysisRunRecord(row) : null;
  }

  async transitionAnalysisRun(input: AnalysisRunTransition) {
    const predicates = [
      eq(brandAnalysisRuns.id, input.runId),
      eq(brandAnalysisRuns.workspaceId, input.workspaceId),
      inArray(brandAnalysisRuns.status, input.expectedStatuses),
    ];
    if (input.expectedStages?.length) {
      predicates.push(inArray(brandAnalysisRuns.stage, input.expectedStages));
    }
    const [row] = await this.db
      .update(brandAnalysisRuns)
      .set({
        status: input.status,
        stage: input.stage,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        updatedAt: input.updatedAt,
      })
      .where(and(...predicates))
      .returning();
    return row ? analysisRunRecord(row) : null;
  }

  async getAnalysisGenerationContext(
    workspaceId: string,
    runId: string,
  ): Promise<AnalysisGenerationContext | null> {
    const [row] = await this.db
      .select({
        run: brandAnalysisRuns,
        source: brandSources,
        answers: onboardingSessions.answers,
        contentLanguage: onboardingSessions.contentLanguage,
      })
      .from(brandAnalysisRuns)
      .innerJoin(
        brandSources,
        and(
          eq(brandSources.id, brandAnalysisRuns.sourceId),
          eq(brandSources.workspaceId, brandAnalysisRuns.workspaceId),
        ),
      )
      .innerJoin(
        onboardingSessions,
        eq(onboardingSessions.workspaceId, brandAnalysisRuns.workspaceId),
      )
      .where(
        and(
          eq(brandAnalysisRuns.workspaceId, workspaceId),
          eq(brandAnalysisRuns.id, runId),
        ),
      )
      .limit(1);
    if (!row) return null;
    return {
      run: analysisRunRecord(row.run),
      source: sourceRecord(row.source),
      answers: onboardingAnswersV1Schema.parse(row.answers),
      contentLanguage: contentLanguageSchema.parse(row.contentLanguage),
    };
  }

  async getDraftProfileByRun(workspaceId: string, runId: string) {
    const [row] = await this.db
      .select()
      .from(brandProfiles)
      .where(
        and(
          eq(brandProfiles.workspaceId, workspaceId),
          eq(brandProfiles.generatedFromRunId, runId),
        ),
      )
      .limit(1);
    return row ? profileRecord(row) : null;
  }

  async getActivationArtifactByProfile(workspaceId: string, profileId: string) {
    const [row] = await this.db
      .select()
      .from(onboardingActivationArtifacts)
      .where(
        and(
          eq(onboardingActivationArtifacts.workspaceId, workspaceId),
          eq(onboardingActivationArtifacts.brandProfileId, profileId),
        ),
      )
      .limit(1);
    return row ? activationArtifactRecord(row) : null;
  }

  async getNextBrandProfileRevision(workspaceId: string) {
    const [row] = await this.db
      .select({ revision: brandProfiles.revision })
      .from(brandProfiles)
      .where(eq(brandProfiles.workspaceId, workspaceId))
      .orderBy(desc(brandProfiles.revision))
      .limit(1);
    return (row?.revision ?? 0) + 1;
  }

  async createDraftProfile(input: BrandProfileRecord) {
    brandProfileV1Schema.parse(input.profile);
    const [created] = await this.db
      .insert(brandProfiles)
      .values(input)
      .onConflictDoNothing({ target: brandProfiles.generatedFromRunId })
      .returning();
    if (created) return profileRecord(created);
    const [existing] = await this.db
      .select()
      .from(brandProfiles)
      .where(eq(brandProfiles.generatedFromRunId, input.generatedFromRunId))
      .limit(1);
    if (!existing) throw new Error("Failed to persist Brand Profile draft.");
    return profileRecord(existing);
  }

  async createActivationArtifact(input: ActivationArtifactRecord) {
    activationArtifactV1Schema.parse(input.artifact);
    const [created] = await this.db
      .insert(onboardingActivationArtifacts)
      .values(input)
      .onConflictDoNothing({
        target: [
          onboardingActivationArtifacts.workspaceId,
          onboardingActivationArtifacts.brandProfileId,
        ],
      })
      .returning();
    if (created) return activationArtifactRecord(created);
    const [existing] = await this.db
      .select()
      .from(onboardingActivationArtifacts)
      .where(
        and(
          eq(onboardingActivationArtifacts.workspaceId, input.workspaceId),
          eq(onboardingActivationArtifacts.brandProfileId, input.brandProfileId),
        ),
      )
      .limit(1);
    if (!existing) throw new Error("Failed to persist activation artifact.");
    return activationArtifactRecord(existing);
  }

  async getAnalysisDispatchIntent(workspaceId: string, runId: string) {
    const [row] = await this.db
      .select()
      .from(onboardingAnalysisDispatchIntents)
      .where(
        and(
          eq(onboardingAnalysisDispatchIntents.workspaceId, workspaceId),
          eq(onboardingAnalysisDispatchIntents.runId, runId),
        ),
      )
      .limit(1);
    return row ? dispatchIntentRecord(row) : null;
  }

  async recordAnalysisDispatch(input: {
    workspaceId: string;
    runId: string;
    succeeded: boolean;
    errorCode?: string | null;
    now: Date;
  }) {
    const [row] = await this.db
      .update(onboardingAnalysisDispatchIntents)
      .set({
        status: input.succeeded ? "dispatched" : "pending",
        attempts: sql`${onboardingAnalysisDispatchIntents.attempts} + 1`,
        lastErrorCode: input.succeeded ? null : input.errorCode ?? "DISPATCH_FAILED",
        dispatchedAt: input.succeeded ? input.now : null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(onboardingAnalysisDispatchIntents.workspaceId, input.workspaceId),
          eq(onboardingAnalysisDispatchIntents.runId, input.runId),
        ),
      )
      .returning();
    return row ? dispatchIntentRecord(row) : null;
  }
}
