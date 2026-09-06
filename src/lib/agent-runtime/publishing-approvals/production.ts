import { getDb } from "@/lib/db";
import {
  DrizzlePublishingApprovalAuthorityRepository,
  DrizzlePublishingApprovalRepository,
  DrizzlePublishingApprovalRevisionRepository,
} from "./postgres-repository";
import {
  AesGcmPublishingApprovalCursorCodec,
  publishingApprovalCursorKeysFromEnvironment,
} from "./cursor";
import { ProductionPublishingApprovalPresentation } from "./production-presentation";
import { PublishingApprovalService } from "./service";
import { DrizzleGovernanceRepository } from "@/lib/governance/postgres-repository";
import { RepositoryPublishingApprovalGovernancePolicy } from "@/lib/governance/publishing-approval-policy";

export const PRODUCTION_PUBLISHING_APPROVAL_REPOSITORY =
  new DrizzlePublishingApprovalRepository(getDb);

export const PRODUCTION_PUBLISHING_APPROVAL_CURSOR =
  new AesGcmPublishingApprovalCursorCodec(
    publishingApprovalCursorKeysFromEnvironment,
  );

export const PRODUCTION_PUBLISHING_APPROVAL_AUTHORITY =
  new DrizzlePublishingApprovalAuthorityRepository(getDb);

/** Explicit grant administration; Workspace role alone never grants decision authority. */
export const PRODUCTION_PUBLISHING_APPROVAL_AUTHORITY_ADMIN =
  PRODUCTION_PUBLISHING_APPROVAL_AUTHORITY;

export const PRODUCTION_PUBLISHING_APPROVAL_REVISIONS =
  new DrizzlePublishingApprovalRevisionRepository(getDb);

export const PRODUCTION_PUBLISHING_APPROVAL_PRESENTATION =
  new ProductionPublishingApprovalPresentation();

export const PRODUCTION_PUBLISHING_APPROVAL_GOVERNANCE_POLICY =
  new RepositoryPublishingApprovalGovernancePolicy(
    new DrizzleGovernanceRepository(getDb),
  );

export const PRODUCTION_PUBLISHING_APPROVAL_SERVICE =
  new PublishingApprovalService(
    PRODUCTION_PUBLISHING_APPROVAL_REPOSITORY,
    PRODUCTION_PUBLISHING_APPROVAL_REVISIONS,
    PRODUCTION_PUBLISHING_APPROVAL_REVISIONS,
    PRODUCTION_PUBLISHING_APPROVAL_AUTHORITY,
    PRODUCTION_PUBLISHING_APPROVAL_PRESENTATION,
    undefined,
    PRODUCTION_PUBLISHING_APPROVAL_GOVERNANCE_POLICY,
  );
