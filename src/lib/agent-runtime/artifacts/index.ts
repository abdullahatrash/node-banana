import { getDb } from "@/lib/db";
import {
  getQuotaCommitWriter,
  getQuotaService,
} from "../quotas/production";
import { AesGcmArtifactCursorCodec, artifactCursorKeysFromEnvironment } from "./cursor";
import { DrizzleArtifactRepository } from "./postgres-repository";
import { ArtifactService } from "./service";
import {
  S3ArtifactContentStore,
  SharpArtifactMediaInspector,
} from "./storage";

export {
  ARTIFACT_CAPABILITY_IDENTITIES,
  createArtifactRegistrations,
} from "./capabilities";

export const PRODUCTION_ARTIFACT_SERVICE = new ArtifactService(
  new DrizzleArtifactRepository(getDb, getQuotaCommitWriter()),
  new S3ArtifactContentStore(),
  new SharpArtifactMediaInspector(),
  new AesGcmArtifactCursorCodec(artifactCursorKeysFromEnvironment),
  undefined,
  getQuotaService(),
);
