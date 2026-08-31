import { getDb } from "@/lib/db";
import { DrizzleCredentialVaultRepository } from "@/lib/credential-vault/repository";
import { CredentialVaultWorkflowSlotAdmission } from "./credential-admission";
import { DrizzleWorkflowRevisionRepository } from "./postgres-repository";
import { WorkflowRevisionValidator } from "./validation";
import { GOLDEN_WORKFLOW_OPERATION_REGISTRY } from "./operation-registry";
import { WorkflowRevisionService } from "./service";

export {
  WORKFLOW_CAPABILITY_IDENTITIES,
  createWorkflowRegistrations,
} from "./capabilities";
export {
  GOLDEN_WORKFLOW_OPERATION_REGISTRY,
  WorkflowOperationRegistry,
} from "./operation-registry";
export {
  WorkflowRevisionService,
} from "./service";
export { WorkflowServiceError } from "./errors";

export const PRODUCTION_WORKFLOW_REVISION_SERVICE =
  new WorkflowRevisionService(
    new DrizzleWorkflowRevisionRepository(getDb),
    new WorkflowRevisionValidator(
      GOLDEN_WORKFLOW_OPERATION_REGISTRY,
      new CredentialVaultWorkflowSlotAdmission(
        new DrizzleCredentialVaultRepository(getDb),
      ),
    ),
  );
