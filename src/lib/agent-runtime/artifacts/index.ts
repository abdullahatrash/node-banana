import { getDb } from "@/lib/db";
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
  new DrizzleArtifactRepository(getDb),
  new S3ArtifactContentStore(),
  new SharpArtifactMediaInspector(),
  new AesGcmArtifactCursorCodec(artifactCursorKeysFromEnvironment),
);
