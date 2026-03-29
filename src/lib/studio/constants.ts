/**
 * Maximum number of active (non-deleted) projects per workspace.
 * This is a soft limit enforced at the API layer. When a billing/plans
 * system is added, this value should be read from the workspace's plan.
 */
export const MAX_PROJECTS_PER_WORKSPACE = 3;
